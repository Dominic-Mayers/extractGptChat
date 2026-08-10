#!/usr/bin/env python3

import argparse
import datetime
import http.server
import json
import os
import pathlib
import queue
import secrets
import signal
import subprocess
import tempfile
import threading
import time
import urllib.parse


class Collector(http.server.ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, address, token):
        self.token = token
        self.results = queue.Queue()
        super().__init__(address, Handler)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/ready", "/result"):
            self.send_error(404)
            return
        if self.headers.get("X-Extract-Gpt-Token") != self.server.token:
            self.send_error(403)
            return
        if self.path == "/ready":
            self.send_response(204)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.send_error(400)
            return
        self.send_response(204)
        self.end_headers()
        self.server.results.put(payload)

    def log_message(self, format, *args):
        return


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument(
        "--browser",
        choices=("chromium", "firefox"),
        default="chromium"
    )
    parser.add_argument("--chromium", default="/usr/bin/chromium-browser")
    parser.add_argument("--firefox", default="/usr/bin/firefox")
    parser.add_argument("--cycles", type=int, default=30)
    parser.add_argument("--timeout-minutes", type=float, default=30)
    parser.add_argument("--between-seconds", type=float, default=2)
    parser.add_argument("--output")
    parser.add_argument(
        "--window-width",
        type=int,
        help="startup window width; the browser decides the viewport"
    )
    parser.add_argument(
        "--window-height",
        type=int,
        help="startup window height; the resulting viewport height is "
             "recorded in each cycle payload"
    )
    return parser.parse_args()


def batch_url(url, port, token, cycle):
    parsed = urllib.parse.urlsplit(url)
    parameters = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    parameters.extend([
        ("_extract_gpt_batch", "1"),
        ("_extract_gpt_port", str(port)),
        ("_extract_gpt_token", token),
        ("_extract_gpt_cycle", str(cycle)),
    ])
    return urllib.parse.urlunsplit(parsed._replace(
        query=urllib.parse.urlencode(parameters)
    ))


def browser_command(options, profile, cache, url):
    if options.browser == "firefox":
        command = [
            options.firefox,
            "--no-remote",
            "-profile",
            str(profile),
        ]
        if options.window_width is not None:
            command += ["-width", str(options.window_width)]
        if options.window_height is not None:
            command += ["-height", str(options.window_height)]
        command += ["-new-window", url]
        return command
    command = [
        options.chromium,
        f"--user-data-dir={profile}",
        f"--disk-cache-dir={cache}",
        "--disk-cache-size=1",
        "--media-cache-size=1",
        "--no-first-run",
        "--disable-session-crashed-bubble",
    ]
    if options.window_width is not None or options.window_height is not None:
        width = options.window_width or 1280
        height = options.window_height or 1000
        command.append(f"--window-size={width},{height}")
    command += ["--new-window", url]
    return command


def stop_process(process):
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)


def wait_for_result(collector, process, timeout_seconds, browser):
    deadline = time.monotonic() + timeout_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Timed out waiting for the extractor result")
        try:
            return collector.results.get(timeout=min(1, remaining))
        except queue.Empty:
            if process.poll() is not None:
                raise RuntimeError(
                    f"{browser} exited with status "
                    f"{process.returncode}"
                )
def main():
    options = arguments()
    if options.cycles < 1:
        raise SystemExit("--cycles must be positive")
    profile = pathlib.Path(options.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    output = pathlib.Path(
        options.output or f"fixed-deck-runs/{stamp}"
    ).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise SystemExit(f"Output directory is not empty: {output}")
    token = secrets.token_urlsafe(24)
    collector = Collector(("127.0.0.1", 0), token)
    server_thread = threading.Thread(
        target=collector.serve_forever,
        daemon=True
    )
    server_thread.start()
    metadata = {
        "url": options.url,
        "profile": str(profile),
        "cycles": options.cycles,
        "startedAt": datetime.datetime.now().isoformat(),
    }
    (output / "batch.json").write_text(
        json.dumps(metadata, indent=2) + "\n"
    )
    try:
        for cycle in range(1, options.cycles + 1):
            url = batch_url(
                options.url,
                collector.server_port,
                token,
                cycle
            )
            with tempfile.TemporaryDirectory(
                prefix=f"extract-gpt-cache-{cycle:02d}-"
            ) as cache:
                command = browser_command(
                    options,
                    profile,
                    cache,
                    url
                )
                process = subprocess.Popen(command, start_new_session=True)
                try:
                    result = wait_for_result(
                        collector,
                        process,
                        options.timeout_minutes * 60,
                        options.browser
                    )
                    if result.get("cycle") != cycle:
                        raise RuntimeError(
                            f"Expected cycle {cycle}, received "
                            f"{result.get('cycle')}"
                        )
                    filename = output / f"cycle-{cycle:02d}.json"
                    filename.write_text(
                        json.dumps(result, indent=2) + "\n"
                    )
                    print(
                        f"cycle {cycle}/{options.cycles}: "
                        f"{result.get('status')} -> {filename}",
                        flush=True
                    )
                    if result.get("status") != "complete":
                        raise RuntimeError(f"Cycle {cycle} failed")
                finally:
                    stop_process(process)
            if cycle < options.cycles:
                time.sleep(options.between_seconds)
    finally:
        collector.shutdown()
        collector.server_close()


if __name__ == "__main__":
    main()
