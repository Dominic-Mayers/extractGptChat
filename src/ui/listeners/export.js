export function attachExportListener({
    button,
    ui,
    getSavedState,
    exportMarkdown,
    countPrompts,
}) {
    button.onclick = async () => {
        const savedState = getSavedState();
        if (!savedState) return;
        button.disabled = true;
        button.innerText = 'Exporting...';
        await exportMarkdown(ui, savedState.allPrompts, ui.includeDiag, savedState.stopped, savedState.timestamp, savedState.stopReason);
        const count = countPrompts(savedState.allPrompts);
        ui.log(`Exported ${count} prompts (${savedState.allPrompts.length} msgs).`);
        button.disabled = false;
        button.innerText = 'Export again';
    };
}
