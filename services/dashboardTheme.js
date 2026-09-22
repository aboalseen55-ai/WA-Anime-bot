export const DASHBOARD_THEME = `
  :root {
    --bg: #0b0d13;
    --panel: rgba(24, 28, 39, 0.86);
    --panel-strong: rgba(30, 35, 49, 0.96);
    --line: rgba(148, 163, 184, 0.16);
    --line-strong: rgba(129, 140, 248, 0.38);
    --text: #f8fafc;
    --muted: #aab4c4;
    --green: #36e39a;
    --blue: #7c9cff;
    --violet: #b58cff;
    --danger: #ff7c96;
    --shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  }

  * { box-sizing: border-box; }
  html { min-height: 100%; background: var(--bg); }
  body {
    min-height: 100vh;
    overflow-x: hidden;
    background:
      radial-gradient(circle at 8% 5%, rgba(124, 156, 255, .16), transparent 28rem),
      radial-gradient(circle at 95% 12%, rgba(181, 140, 255, .12), transparent 24rem),
      linear-gradient(145deg, #0b0d13 0%, #121624 46%, #0d1018 100%);
    letter-spacing: 0;
  }
  body::before {
    content: "✦   ◇   ✧";
    position: fixed;
    inset: 15% auto auto 4%;
    z-index: -1;
    color: rgba(181, 140, 255, .2);
    font-size: 22px;
    letter-spacing: 18px;
    animation: floatMarks 9s ease-in-out infinite;
    pointer-events: none;
  }
  body::after {
    content: "◇   ✦";
    position: fixed;
    inset: auto 7% 12% auto;
    z-index: -1;
    color: rgba(124, 156, 255, .18);
    font-size: 18px;
    letter-spacing: 14px;
    animation: floatMarks 11s ease-in-out infinite reverse;
    pointer-events: none;
  }
  @keyframes floatMarks { 0%,100%{transform:translate3d(0,0,0) rotate(-3deg)} 50%{transform:translate3d(8px,-14px,0) rotate(4deg)} }

  header {
    height: 74px;
    padding: 0 max(5vw, 22px);
    background: rgba(12, 15, 23, .78);
    border-bottom: 1px solid var(--line);
    box-shadow: 0 12px 36px rgba(0,0,0,.16);
    backdrop-filter: blur(18px);
  }
  .brand { display:flex; align-items:center; gap:10px; font-size:19px; letter-spacing:.2px; }
  .dot { margin:0; width:10px; height:10px; box-shadow:0 0 0 5px rgba(255,124,150,.1); }
  .dot.online { box-shadow:0 0 0 5px rgba(54,227,154,.12), 0 0 18px rgba(54,227,154,.58); }
  main { max-width: 1180px; margin: 0 auto; padding: 42px 24px 72px; }
  .grid { gap: 20px; }
  .card {
    position: relative;
    overflow: hidden;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: linear-gradient(145deg, rgba(30,35,49,.88), rgba(18,22,32,.9));
    box-shadow: var(--shadow);
    backdrop-filter: blur(18px);
    transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
  }
  .card::after { content:""; position:absolute; inset:0 0 auto; height:1px; background:linear-gradient(90deg,transparent,rgba(181,140,255,.65),transparent); opacity:.55; }
  .card:hover { transform:translateY(-2px); border-color:var(--line-strong); box-shadow:0 28px 90px rgba(0,0,0,.42); }
  .wide:first-child { background:linear-gradient(110deg, rgba(52,67,131,.7), rgba(72,44,117,.52) 58%, rgba(24,29,43,.9)); }
  h1 { font-size: clamp(24px, 3vw, 32px); letter-spacing:-.3px; }
  h2 { display:flex; align-items:center; gap:9px; font-size:18px; }
  h2::before { content:"✦"; color:var(--violet); font-size:15px; }
  .muted { color:var(--muted); }
  .status { border-color:var(--line-strong); background:rgba(8,12,20,.26); color:#dbeafe; }
  label { color:#c0cada; font-weight:600; }
  input, select, textarea {
    border:1px solid var(--line);
    border-radius:9px;
    background:rgba(8,11,18,.64);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.035);
    transition:border-color .18s ease, box-shadow .18s ease, background .18s ease;
  }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--blue); background:rgba(10,15,25,.9); box-shadow:0 0 0 3px rgba(124,156,255,.14); }
  textarea { min-height:110px; line-height:1.65; }
  button { border-radius:9px; padding:11px 17px; background:linear-gradient(135deg,#36e39a,#21bb9c); color:#06251b; box-shadow:0 8px 22px rgba(54,227,154,.16); transition:transform .18s ease, filter .18s ease, box-shadow .18s ease; }
  button::before { content:"✦"; margin-left:7px; }
  button:hover { transform:translateY(-1px); filter:brightness(1.08); box-shadow:0 11px 28px rgba(54,227,154,.24); }
  button.secondary { background:linear-gradient(135deg,rgba(73,87,122,.82),rgba(46,53,74,.92)); color:var(--text); box-shadow:none; }
  button.secondary::before { content:"◈"; }
  button.danger { background:linear-gradient(135deg,rgba(117,43,63,.92),rgba(78,31,47,.96)); color:#ffdce4; box-shadow:none; }
  button.danger::before { content:"×"; }
  .actions { gap:10px; }
  .item { padding:17px 0; border-color:var(--line); }
  .tag { border:1px solid rgba(124,156,255,.25); background:rgba(48,75,139,.26); color:#c9d7ff; }
  #login { margin: max(12vh, 70px) auto; padding:32px; border-color:rgba(181,140,255,.35); box-shadow:0 30px 100px rgba(38,25,75,.38); }
  #login h1 { background:linear-gradient(90deg,#fff,#c5b4ff 70%,#8db4ff); color:transparent; background-clip:text; }
  #login button { width:100%; margin-top:8px; }
  .notice { color:#ffd58a; }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
  @media (max-width:760px) { main { padding:24px 14px 52px; } .card { padding:19px; } header { padding:0 16px; } }
`;
