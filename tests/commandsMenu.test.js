import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRootMenu, showCommandsList, handleCommandsMenuReply, isMenuTrigger } from '../commands/commandsList.js';
import { handleSlashCommand } from '../handlers/commandRouting.js';

function withMode(t, mode) {
  const previous = process.env.BOT_MODE;
  process.env.BOT_MODE = mode;
  t.after(() => { if (previous === undefined) delete process.env.BOT_MODE; else process.env.BOT_MODE = previous; });
}

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

const titles = (menu) => menu.map(node => node.title).join(' | ');
const USER = '962711111111@s.whatsapp.net';

test('menu sections follow BOT_MODE and role', () => {
  const personal = titles(buildRootMenu({ personal: true, fun: false }));
  assert.match(personal, /المصاريف/);
  assert.match(personal, /الذاكرة/);
  assert.doesNotMatch(personal, /البنك|الألعاب|الممالك|المطور/);

  const fun = titles(buildRootMenu({ personal: false, fun: true }));
  assert.match(fun, /الألعاب/);
  assert.doesNotMatch(fun, /المصاريف|المشرفين|الأدمن/);
  assert.match(titles(buildRootMenu({ personal: false, fun: true, roles: new Set(['moderator']) })), /المشرفين/);

  const all = buildRootMenu({ personal: true, fun: true });
  assert.ok(all.length > buildRootMenu({ personal: true, fun: false }).length);
});

test('every menu item is either a numbered submenu or a list of commands', () => {
  const walk = (nodes) => nodes.forEach(node => {
    assert.ok(node.title);
    if (node.items) walk(node.items); else assert.ok(node.lines?.length, node.title);
  });
  walk(buildRootMenu({ personal: true, fun: true, roles: new Set(['moderator', 'admin', 'developer']) }));
});

test('menu triggers include /أوامر and /مساعدة spellings', () => {
  for (const t of ['/أوامر', '/اوامر', '/الأوامر', '/مساعدة', '/مساعده', '/help']) assert.ok(isMenuTrigger(t), t);
  assert.equal(isMenuTrigger('/مساعدي'), false);
  assert.equal(isMenuTrigger('أوامر'), false);
});

test('numbers walk the personal menu: submenu, leaf, back, and other text closes it', async t => {
  withMode(t, 'personal');
  const sock = fakeSock();
  await handleSlashCommand(sock, USER, USER, '/أوامر', {});
  const root = sock.sent.at(-1).text;
  assert.match(root, /1\. 💬/);
  assert.match(root, /ارسل رقم/);
  assert.doesNotMatch(root, /الألعاب|البنك/);

  // 2 = التذكيرات والمهام (قائمة فرعية)
  assert.equal(await handleCommandsMenuReply(sock, USER, USER, '2'), true);
  assert.match(sock.sent.at(-1).text, /1\. ⏰ التذكيرات/);
  assert.match(sock.sent.at(-1).text, /0 للرجوع/);

  assert.equal(await handleCommandsMenuReply(sock, USER, USER, '٢'), true);
  assert.match(sock.sent.at(-1).text, /\/مهمة/);

  assert.equal(await handleCommandsMenuReply(sock, USER, USER, '9'), true);
  assert.match(sock.sent.at(-1).text, /اختار رقم من 1 لـ 3/);

  assert.equal(await handleCommandsMenuReply(sock, USER, USER, '0'), true);
  assert.equal(sock.sent.at(-1).text, root);

  assert.equal(await handleCommandsMenuReply(sock, USER, USER, 'شو الأخبار'), false);
  assert.equal(await handleCommandsMenuReply(sock, USER, USER, '1'), false);
});

test('a number without an open menu is left alone', async () => {
  const sock = fakeSock();
  assert.equal(await handleCommandsMenuReply(sock, 'x@s.whatsapp.net', 'x@s.whatsapp.net', '1'), false);
  assert.equal(sock.sent.length, 0);
});

test('menus are per chat, so a group menu does not catch numbers in DM', async t => {
  withMode(t, 'personal');
  const sock = fakeSock();
  await showCommandsList(sock, 'g@g.us', USER);
  assert.equal(await handleCommandsMenuReply(sock, USER, USER, '1'), false);
  assert.equal(await handleCommandsMenuReply(sock, 'g@g.us', USER, '1'), true);
});
