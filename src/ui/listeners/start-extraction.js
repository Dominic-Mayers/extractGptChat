export function attachStartExtractionListener({
    button,
    stopButton,
    ui,
    showRunningState,
    showIdleState,
    run,
    getResumeState,
    setResumeState,
    getPendingAutoRestart,
    setPendingAutoRestart,
    getSavedState,
    incrementAutoResumeCount,
}) {
    button.onclick = async () => {
        let resumeState = getResumeState();
        setResumeState(null);
        setPendingAutoRestart(false);
        showRunningState();
        try {
            let autoResumeCount = 0;
            let runPass = 0;
            do {
                if (resumeState && runPass > 0) {
                    const count = incrementAutoResumeCount();
                    ui.log(`Auto-resuming from current cursor (${count}).`);
                }
                await run(ui, stopButton, resumeState);
                runPass++;
                resumeState = getResumeState();
                setResumeState(null);
                if (resumeState) autoResumeCount++;
            } while (!ui.stopped && (getPendingAutoRestart() || (resumeState && autoResumeCount <= 1)));
            const savedState = getSavedState();
            showIdleState(resumeState ? 'Resume from current' : 'Restart',
                ui.stopped || !!savedState?.stopReason || !!resumeState);
        } catch (err) {
            stopButton.style.display = 'none';
            ui.log(`ERROR: ${err.message}`);
            showIdleState('Retry', true);
            Object.assign(button.style, { background: '#f38ba8', color: '#11111b' });
        }
    };
}
