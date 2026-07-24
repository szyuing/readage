/** Format selected article text as a discussion quote without losing draft text. */
export function formatSelectionQuote(selectedText: string, currentInput = ''): string {
  const normalizedText = selectedText.trim();
  if (!normalizedText) return currentInput;

  const quote = normalizedText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  const draft = currentInput.trimEnd();

  return draft ? `${draft}\n\n${quote}\n\n` : `${quote}\n\n`;
}
