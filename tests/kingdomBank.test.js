import test from 'node:test';
import assert from 'node:assert/strict';
import Bank from '../database/bankModel.js';
import User from '../database/userModel.js';
import { addCoins, removeCoins } from '../commands/adminSystem.js';

const GROUP = '120363000000000001@g.us';
const KINGDOM = 'clover';
const ADMIN = '111@s.whatsapp.net';
const MEMBER = '222@s.whatsapp.net';

function fakeSock() {
  const sent = [];
  return { sent, sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); } };
}

function setup(t, { bankCoins, memberCoins = 0 }) {
  const bank = { kingdom: KINGDOM, totalCoins: bankCoins, transactions: [] };
  const member = { jid: MEMBER, nickname: 'زورو', kingdom_id: KINGDOM, coins: memberCoins, save: async () => {} };
  const admin = { jid: ADMIN, nickname: 'سامر', kingdom_id: KINGDOM, role: 'super_admin', save: async () => {} };
  t.mock.method(User, 'findOne', async q => (q.jid === ADMIN ? admin : q.nickname ? member : null));
  t.mock.method(Bank, 'findOne', q => {
    const row = q.kingdom === KINGDOM ? bank : null;
    const p = Promise.resolve(row);
    p.lean = () => Promise.resolve(row);
    return p;
  });
  t.mock.method(Bank, 'findOneAndUpdate', async (q, u) => {
    if (q.kingdom !== KINGDOM || bank.totalCoins < q.totalCoins.$gte) return null;
    bank.totalCoins += u.$inc.totalCoins;
    bank.transactions.push(u.$push.transactions);
    return bank;
  });
  t.mock.method(Bank, 'updateOne', async (q, u) => {
    bank.totalCoins += u.$inc.totalCoins;
    if (u.$push) bank.transactions.push(u.$push.transactions);
  });
  return { bank, member };
}

test('admin giving coins takes them out of the kingdom bank', async t => {
  const { bank, member } = setup(t, { bankCoins: 1000, memberCoins: 10 });
  const sock = fakeSock();
  assert.equal(await addCoins(sock, GROUP, 'زورو', 300, ADMIN, KINGDOM), true);
  assert.equal(bank.totalCoins, 700);
  assert.equal(member.coins, 310);
  assert.deepEqual(bank.transactions[0], { type: 'admin_grant', userJid: MEMBER, amount: 300 });
  assert.match(sock.sent.at(-1).text, /رصيد بنك المملكة: 700/);
});

test('admin cannot give more than the kingdom bank holds', async t => {
  const { bank, member } = setup(t, { bankCoins: 100, memberCoins: 10 });
  const sock = fakeSock();
  assert.equal(await addCoins(sock, GROUP, 'زورو', 500, ADMIN, KINGDOM), false);
  assert.equal(bank.totalCoins, 100);
  assert.equal(member.coins, 10);
  assert.match(sock.sent.at(-1).text, /لا يكفي/);
});

test('admin giving zero or negative coins is refused', async t => {
  const { bank, member } = setup(t, { bankCoins: 100, memberCoins: 10 });
  assert.equal(await addCoins(fakeSock(), GROUP, 'زورو', -50, ADMIN, KINGDOM), false);
  assert.equal(bank.totalCoins, 100);
  assert.equal(member.coins, 10);
});

test('coins an admin removes go back to the kingdom bank', async t => {
  const { bank, member } = setup(t, { bankCoins: 100, memberCoins: 40 });
  assert.equal(await removeCoins(fakeSock(), GROUP, 'زورو', 60, ADMIN, KINGDOM), true);
  assert.equal(member.coins, 0);
  assert.equal(bank.totalCoins, 140);
});
