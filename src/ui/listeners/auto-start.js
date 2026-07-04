export function attachAutoStartListener({
    enabled,
    panel,
    startButton,
    sleep,
    getNavMenuItems,
}) {
    if (!enabled) return;
    console.log('[Extractor] auto-start: polling for nav items...');
    (async () => {
        const deadline = Date.now() + 30_000;
        while (getNavMenuItems().length === 0 && Date.now() < deadline) {
            await sleep(100);
        }
        const found = getNavMenuItems().length;
        console.log('[Extractor] auto-start: nav items found =', found, '- clicking Start Extraction:', found > 0);
        if (found === 0) return;
        panel.style.display = '';
        startButton.click();
    })();
}
