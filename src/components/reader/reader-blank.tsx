/** The reader's page colour (from the saved theme, set before first paint) while the reader loads. */
export function ReaderBlank() {
  return <div aria-hidden className="loam-blank fixed inset-0 z-10" />;
}
