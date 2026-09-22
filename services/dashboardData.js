import fs from 'node:fs';
import { parse } from 'acorn';
import { COMMANDS_REGISTRY } from '../commands/commandsRegistry.js';
import Kingdom from '../database/kingdomModel.js';
import User from '../database/userModel.js';
import Usage from '../database/samBotUsageModel.js';
import Audit from '../database/kingdomAuditLogModel.js';
import MafiaSession from '../database/mafiaSessionModel.js';
import Bank from '../database/bankModel.js';
import { refreshKingdomCache, createKingdomFromRegistration, deleteKingdomById } from '../utils/kingdomService.js';
import { DEVELOPER_JID } from '../config.js';
import { getDailyGameStats, generateAdminDailyReport } from '../commands/adminSystem.js';

export const catalog = Object.entries(COMMANDS_REGISTRY).flatMap(([section, rows]) => rows.map(row => ({ ...row, section })));
const known = new Set(catalog.map(row => row.command.split(/\s/)[0]));
for (const directory of ['commands', 'games', 'handlers', 'utils']) {
  for (const entry of fs.readdirSync(new URL('../' + directory + '/', import.meta.url)).filter(name => name.endsWith('.js') && name !== 'admin.js')) {
    const source = fs.readFileSync(new URL('../' + directory + '/' + entry, import.meta.url), 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Literal' && typeof node.value === 'string' && /^\/[\p{L}\p{N}_-]{1,48}$/u.test(node.value) && !known.has(node.value)) {
        known.add(node.value);
        catalog.push({ command: node.value, description: 'أمر مدمج', section: directory, file: directory + '/' + entry, usage: node.value });
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(ast);
  }
}
export function isReservedCommand(trigger) { return known.has(trigger); }
const fields = 'id name mainGroup receptionGroup workGroup adminGroup groupIds admins mainGroupInviteLink receptionGroupInviteLink workGroupInviteLink adminGroupInviteLink announcementLink timeZone isActive updatedAt';
const groupFields = ['mainGroup', 'receptionGroup', 'workGroup', 'adminGroup'];
const linkFields = ['mainGroupInviteLink', 'receptionGroupInviteLink', 'workGroupInviteLink', 'adminGroupInviteLink', 'announcementLink'];
const memberFields = 'kingdom_id nickname whatsappName jid lid role points coins isBanned banReason xp level chatXp gameXp dailyMessages totalMessages dailyWelcomes dailyGameAnswers dailyGameXp dailyRankStarsEarned rankStarsByKingdom kingdomRankByKingdom lastActivityAt';
export const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function pagination(url) { return { page: Math.max(1, Math.min(10000, parseInt(url.searchParams.get('page'), 10) || 1)), limit: 30 }; }

export async function audit(action, target, kingdomId = null) {
  await Audit.create({ action: 'dashboard_' + action, actorJid: 'dashboard:owner', kingdomId, details: { target: String(target) } });
}

export async function dashboardRead(url) {
  const route = url.pathname.replace('/dashboard/api/', '');
  const { page, limit } = pagination(url);
  const kingdom = String(url.searchParams.get('kingdom') || '');
  if (route === 'catalog') return { commands: catalog };
  if (route === 'kingdoms') return { kingdoms: await Kingdom.find({}).select(fields).sort({ name: 1 }).lean() };
  if (route === 'members') {
    if (!kingdom || !await Kingdom.exists({ id: kingdom })) return { users: [], total: 0, page };
    const query = { kingdom_id: kingdom };
    const search = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    if (search) query.$or = ['nickname', 'whatsappName'].map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } }));
    const [users, total] = await Promise.all([User.find(query).select(memberFields).sort({ nickname: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(query)]);
    return { users, total, page };
  }
  if (route === 'overview') {
    const filter = kingdom ? { kingdom_id: kingdom } : {};
    const [totals, kingdoms, top, games] = await Promise.all([
      User.aggregate([{ $match: filter }, { $group: { _id: null, members: { $sum: 1 }, messages: { $sum: '$totalMessages' }, dailyMessages: { $sum: '$dailyMessages' }, answers: { $sum: '$dailyGameAnswers' }, welcomes: { $sum: '$dailyWelcomes' }, xp: { $sum: '$xp' }, stars: { $sum: '$dailyRankStarsEarned' } } }]),
      Kingdom.countDocuments({}),
      User.find(filter).select(memberFields).sort({ dailyMessages: -1, dailyGameAnswers: -1 }).limit(10).lean(),
      User.find({ ...filter, dailyGameAnswers: { $gt: 0 } }).select('nickname kingdom_id dailyGameAnswers dailyGameXp').sort({ dailyGameAnswers: -1 }).limit(10).lean()
    ]);
    return { totals: { ...(totals[0] || {}), kingdoms }, top, games, generatedAt: new Date() };
  }
  if (route === 'usage') {
    const [rows, total] = await Promise.all([Usage.find({}).select('-lastError').sort({ dateKey: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), Usage.countDocuments({})]);
    return { rows, total, page };
  }
  if (route === 'audit') {
    const query = kingdom ? { kingdomId: kingdom } : {};
    const [rows, total] = await Promise.all([Audit.find(query).select('action actorJid kingdomId createdAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Audit.countDocuments(query)]);
    return { rows, total, page };
  }
  if (route === 'games') {
    let query = {};
    if (kingdom) { const k = await Kingdom.findOne({ id: kingdom }).lean(); query = { groupId: { $in: k ? [...(k.groupIds || []), ...groupFields.map(f => k[f])].filter(Boolean) : [] } }; }
    const [rows, total] = await Promise.all([MafiaSession.find(query).select('groupId status hostNickname createdAt updatedAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), MafiaSession.countDocuments(query)]);
    const filter = kingdom ? { kingdom_id: kingdom } : {};
    const [sessionResult] = await User.aggregate([{ $match: filter }, { $unwind: '$gamesSessions' }, { $facet: { rows: [{ $sort: { 'gamesSessions.startTime': -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }, { $project: { nickname: 1, kingdom_id: 1, session: '$gamesSessions' } }], count: [{$count:'total'}] } }]);
    return { rows, total: Math.max(total,sessionResult?.count?.[0]?.total||0), page, sessions: sessionResult?.rows||[] };
  }
  if (route === 'reports') {
    const query = { role: { $in: ['moderator','admin','super_admin'] }, ...(kingdom ? { kingdom_id: kingdom } : {}), $or: [{dailyMessages:{$gt:0}},{dailyWelcomes:{$gt:0}},{dailyGameAnswers:{$gt:0}},{dailyRankStarsEarned:{$gt:0}},{'gamesSessions.0':{$exists:true}}] };
    const [rows,total] = await Promise.all([User.find(query).select(memberFields+' gamesSessions').sort({dailyWelcomes:-1,dailyMessages:-1}).skip((page-1)*limit).limit(limit).lean(),User.countDocuments(query)]);
    const zones = new Map((await Kingdom.find({}).select('id timeZone').lean()).map(k=>[k.id,k.timeZone||'Asia/Amman']));
    return {rows:rows.map(user=>{const timeZone=zones.get(user.kingdom_id)||'Asia/Amman';return {...user,sessionCount:getDailyGameStats(user.jid,user,timeZone).sessionCount,report:generateAdminDailyReport(user,timeZone)}}),total,page};
  }
  if (route === 'banks') {
    const query = kingdom ? { kingdom } : {};
    const banks = await Bank.find(query).select('kingdom totalCoins').lean();
    const [result] = await Bank.aggregate([{ $match: query },{ $unwind: '$transactions' },{ $facet: { rows: [{ $sort: {'transactions.timestamp':-1} },{ $skip: (page-1)*limit },{ $limit:limit },{ $project: {kingdom:1,transaction:'$transactions'} }], count:[{$count:'total'}] } }]);
    return {banks,rows:result?.rows||[],total:result?.count?.[0]?.total||0,page};
  }
  return null;
}

export function validateKingdom(input) {
  const result = { name: String(input.name || '').trim(), timeZone: String(input.timeZone || 'Asia/Amman'), isActive: input.isActive !== false };
  if (!result.name || result.name.length > 100) throw new Error('اسم المملكة مطلوب وبحد أقصى 100 حرف');
  try { new Intl.DateTimeFormat('en', { timeZone: result.timeZone }).format(); } catch { throw new Error('المنطقة الزمنية غير صالحة'); }
  for (const field of groupFields) {
    result[field] = String(input[field] || '').trim();
    if ((result[field] || field === 'mainGroup') && !/^[0-9-]+@g\.us$/.test(result[field])) throw new Error('معرّف المجموعة غير صالح');
  }
  const assigned = groupFields.map(f => result[f]).filter(Boolean);
  if (new Set(assigned).size !== assigned.length) throw new Error('لا يمكن تعيين نفس المجموعة لأكثر من دور');
  for (const field of linkFields) {
    result[field] = String(input[field] || '').trim();
    if (result[field]) {
      let url;
      try { url = new URL(result[field]); } catch { throw new Error('رابط الدعوة غير صالح'); }
      if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com' || url.username || url.password || url.port) throw new Error('استخدم رابط دعوة واتساب HTTPS');
    }
  }
  const list = value => Array.isArray(value) ? value : String(value || '').split(/[\n,،]/).map(s => s.trim()).filter(Boolean);
  result.admins = [...new Set(list(input.admins))];
  if (!result.admins.length || result.admins.some(j => !/^\d+@(lid|s\.whatsapp\.net)$/.test(j))) throw new Error('أضف أدمن واحدًا على الأقل بمعرّف واتساب أو LID صالح');
  const extras = list(input.extraGroupIds);
  if (extras.some(j => !/^[0-9-]+@g\.us$/.test(j))) throw new Error('معرّف المجموعة الإضافية غير صالح');
  result.groupIds = [...new Set([...assigned, ...extras])];
  return result;
}

export async function dashboardWrite(route, method, input, onKingdomChange = () => {}, getGroups) {
  if (route === 'kingdoms' && method === 'POST') {
    const values = validateKingdom(input);
    if(getGroups) await checkJoinedGroups(values.groupIds,getGroups);
    await checkGroupOwnership(values.groupIds);
    const created = await createKingdomFromRegistration({ ...values, ownerJid: values.admins[0], extraGroupIds: values.groupIds }, DEVELOPER_JID, null);
    await Kingdom.updateOne({ id: created.id }, { $set: values }, { runValidators: true });
    await refreshKingdomCache(); await onKingdomChange(); await audit('kingdom_created', created.id, created.id);
    return { ok: true, id: created.id };
  }
  const kingdomMatch = /^kingdoms\/([a-z0-9_-]+)$/.exec(route);
  if (kingdomMatch && ['PUT', 'DELETE'].includes(method)) {
    const id = kingdomMatch[1];
    const existing = await Kingdom.findOne({ id }).lean();
    if (!existing) throw new Error('المملكة غير موجودة');
    if (method === 'DELETE') {
      if (input.confirm !== existing.name) throw new Error('اكتب اسم المملكة لتأكيد حذفها مع أعضائها وبنكها وجلساتها');
      await deleteKingdomById(id, DEVELOPER_JID);
    } else {
      const values = validateKingdom(input);
      if(getGroups) await checkJoinedGroups(values.groupIds.filter(id=>![...(existing.groupIds||[]),...groupFields.map(f=>existing[f])].includes(id)),getGroups);
      await checkGroupOwnership(values.groupIds, id);
      const saved = await Kingdom.updateOne({ id, updatedAt: input.updatedAt }, { $set: values }, { runValidators: true });
      if (!saved.matchedCount) throw new Error('تغيّرت المملكة منذ فتحها. حدّث الصفحة وحاول مجددًا');
      await audit('kingdom_updated', id, id);
      await refreshKingdomCache();
    }
    await onKingdomChange(); return { ok: true };
  }
  const memberMatch = /^members\/([a-f0-9]{24})$/.exec(route);
  if (memberMatch && method === 'PUT') {
    const user = await User.findOne({ _id: memberMatch[1], kingdom_id: String(input.kingdom || '') });
    if (!user) throw new Error('العضو غير موجود في المملكة المختارة');
    const nickname = String(input.nickname || '').trim();
    if (!nickname || nickname.length > 80) throw new Error('اللقب مطلوب وبحد أقصى 80 حرف');
    if (await User.exists({ kingdom_id: user.kingdom_id, _id: { $ne: user._id }, nickname: { $regex: '^' + escapeRegex(nickname) + '$', $options: 'i' } })) throw new Error('اللقب مستخدم في هذه المملكة');
    if (!['member', 'moderator', 'admin', 'super_admin'].includes(input.role)) throw new Error('صلاحية غير صالحة');
    user.nickname = nickname; user.role = input.role; user.isBanned = input.isBanned === true;
    user.banReason = user.isBanned ? String(input.banReason || '').slice(0, 300) : '';
    user.bannedAt = user.isBanned ? user.bannedAt || new Date() : null;
    await user.save(); await audit('member_updated', user._id, user.kingdom_id);
    return { ok: true };
  }
  return null;
}

async function checkGroupOwnership(groups, exceptId) {
  const query = { $or: [{ groupIds: { $in: groups } }, ...groupFields.map(field => ({ [field]: { $in: groups } }))] };
  if (exceptId) query.id = { $ne: exceptId };
  if (await Kingdom.exists(query)) throw new Error('إحدى المجموعات مرتبطة بمملكة أخرى');
}

async function checkJoinedGroups(groups,getGroups) {
  if(!groups.length)return;
  const joined=new Set((await getGroups()).map(group=>group.id));
  if(groups.some(id=>!joined.has(id)))throw new Error('البوت غير موجود في إحدى المجموعات المختارة');
}
