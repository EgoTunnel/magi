// Runs before paint so the stored theme applies with no flash of the wrong mode.
export function ThemeScript() {
  const code = `
    try {
      var stored = localStorage.getItem("magi-theme");
      if (stored === "light" || stored === "dark") {
        document.documentElement.setAttribute("data-theme", stored);
      }
    } catch (e) {}
  `;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
