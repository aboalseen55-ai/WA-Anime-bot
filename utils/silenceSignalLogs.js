// مكتبة libsignal (داخل Baileys) تطبع كائن الجلسة كاملًا ومعه مفاتيح التشفير الخاصة
// في السجلات عند فتح الجلسات أو إغلاقها. نطبع اسم الحدث فقط بدون الكائن.
const SIGNAL_SESSION_PREFIXES = [
  "Closing session",
  "Opening session",
  "Removing old closed session",
  "Session already closed",
  "Migrating session to"
];

function isSignalSessionLog(args) {
  return typeof args[0] === "string" && SIGNAL_SESSION_PREFIXES.some((prefix) => args[0].startsWith(prefix));
}

for (const level of ["info", "warn", "log"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    if (isSignalSessionLog(args)) {
      original(args[0].replace(/:\s*$/, ""));
      return;
    }
    original(...args);
  };
}
