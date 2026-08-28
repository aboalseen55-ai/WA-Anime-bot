import MafiaPlayer from "../database/mafiaPlayerModel.js";
import MafiaSession from "../database/mafiaSessionModel.js";
import { classifyIdentifier, getCleanMentionTextForUser } from "../commands/adminSystem.js";

const ROLE_LABELS = {
  host: "الراوي",
  civilian: "مواطن",
  mafia: "مافيا",
  sheikh: "الشيخ",
  girl: "البنت",
  boy: "الولد"
};

const ROLE_ICONS = {
  [ROLE_LABELS.civilian]: "👤",
  [ROLE_LABELS.mafia]: "🕵️‍♂️",
  [ROLE_LABELS.sheikh]: "🔎",
  [ROLE_LABELS.girl]: "🛡️",
  [ROLE_LABELS.boy]: "⚡"
};

const ACTIVE_STATUSES = ["collecting_players", "collecting_config", "roles_distributed", "game_over"];
const PRIVATE_NICKNAME_MESSAGE = `أهلًا 👋
اكتب اسمك أو لقبك الذي تريد استخدامه في لعبة المافيا.`;
const JOIN_COMMAND_PATTERN = /^(\/انضم_مافيا|انضم|مشارك|بلعب)$/i;
const START_SETUP_PATTERN = /^(\/ابدأ_مافيا|\/ابدا_مافيا)$/i;

function isGroupJid(jid) {
  return String(jid || "").endsWith("@g.us");
}

function normalizeJid(jid) {
  const value = String(jid || "");
  if (!value.includes(":")) return value;

  const [userPart] = value.split(":");
  const serverPart = value.split("@")[1];
  return serverPart ? `${userPart}@${serverPart}` : userPart;
}

function buildIdentity(jid) {
  const identifier = classifyIdentifier(jid);
  const normalizedJid = identifier.jid || normalizeJid(jid);
  return {
    ...identifier,
    jid: normalizedJid
  };
}

function buildIdentifierKey(identifier, fallbackJid) {
  if (identifier.lid) return `lid:${identifier.lid}`;
  if (identifier.rawLid) return `raw_lid:${identifier.rawLid}`;
  if (identifier.phoneNumber) return `phone:${identifier.phoneNumber}`;
  return `jid:${identifier.jid || normalizeJid(fallbackJid)}`;
}

function buildIdentityQuery(identifier, fallbackJid) {
  const clauses = [];
  const normalizedJid = identifier.jid || normalizeJid(fallbackJid);

  if (normalizedJid) clauses.push({ jid: normalizedJid });
  if (identifier.lid) clauses.push({ lid: identifier.lid });
  if (identifier.rawLid) clauses.push({ rawLid: identifier.rawLid });
  if (identifier.phoneNumber) clauses.push({ phoneNumber: identifier.phoneNumber });

  return clauses.length ? { $or: clauses } : { identifierKey: buildIdentifierKey(identifier, fallbackJid) };
}

function yesNo(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/^(نعم|اه|أه|اي|إي|yes|y|1)$/i.test(text)) return true;
  if (/^(لا|لأ|no|n|0)$/i.test(text)) return false;
  return null;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function hostMention(hostJid) {
  return getCleanMentionTextForUser(normalizeJid(hostJid));
}

function sameIdentity(stored, identifier, fallbackJid) {
  const normalizedJid = identifier.jid || normalizeJid(fallbackJid);
  return (
    (normalizedJid && stored.jid && normalizeJid(stored.jid) === normalizedJid) ||
    (identifier.lid && stored.lid === identifier.lid) ||
    (identifier.rawLid && stored.rawLid === identifier.rawLid) ||
    (identifier.phoneNumber && stored.phoneNumber === identifier.phoneNumber)
  );
}

function buildSessionPlayer(jid, nickname = null) {
  const identity = buildIdentity(jid);
  return {
    jid: identity.jid || normalizeJid(jid),
    lid: identity.lid || null,
    rawLid: identity.rawLid || null,
    phoneNumber: identity.phoneNumber || null,
    identifierType: identity.identifierType,
    nickname,
    role: null,
    alive: true
  };
}

function findSessionPlayerIndex(session, jid) {
  const identity = buildIdentity(jid);
  return (session.players || []).findIndex((player) => sameIdentity(player, identity, jid));
}

async function findMafiaPlayerByJid(jid) {
  const identity = buildIdentity(jid);
  return MafiaPlayer.findOne(buildIdentityQuery(identity, jid));
}

async function upsertMafiaPlayerIdentity(jid, groupId, extra = {}) {
  const identity = buildIdentity(jid);
  const identifierKey = buildIdentifierKey(identity, jid);
  const query = buildIdentityQuery(identity, jid);
  const update = {
    $set: {
      identifierKey,
      jid: identity.jid || normalizeJid(jid),
      lid: identity.lid || null,
      rawLid: identity.rawLid || null,
      phoneNumber: identity.phoneNumber || null,
      identifierType: identity.identifierType,
      ...extra
    }
  };

  if (groupId) {
    update.$addToSet = { groupIds: groupId };
  }

  return MafiaPlayer.findOneAndUpdate(query, update, { new: true, upsert: true });
}

async function promptMafiaNicknameRegistration(sock, participantJid, groupId) {
  const existingPlayer = await findMafiaPlayerByJid(participantJid);
  if (existingPlayer?.nickname) {
    if (groupId && !existingPlayer.groupIds?.includes(groupId)) {
      existingPlayer.groupIds = [...(existingPlayer.groupIds || []), groupId];
      await existingPlayer.save();
    }
    return false;
  }

  const player = await upsertMafiaPlayerIdentity(participantJid, groupId, {
    awaitingNickname: true,
    lastPromptedAt: new Date()
  });

  try {
    await sock.sendMessage(player.jid || participantJid, { text: PRIVATE_NICKNAME_MESSAGE });
    return true;
  } catch (error) {
    console.warn(`⚠️ تعذر إرسال طلب لقب المافيا إلى ${participantJid}: ${error.message}`);
    return false;
  }
}

export async function handleMafiaNicknameRegistration(sock, jid, sender, text) {
  const command = String(text || "").trim();
  const directCommand = command.match(/^\/لقب_مافيا\s+(.+)/i);

  if (directCommand) {
    const nickname = directCommand[1].trim();
    const result = await saveMafiaNickname(sender, nickname, isGroupJid(jid) ? jid : null);
    await sock.sendMessage(jid, { text: result.message });
    return true;
  }

  if (isGroupJid(jid)) return false;
  if (command.startsWith("/")) return false;

  const player = await findMafiaPlayerByJid(sender);
  if (!player?.awaitingNickname || player.nickname) return false;

  const result = await saveMafiaNickname(sender, command, player.groupIds?.[0] || null);
  await sock.sendMessage(jid, { text: result.message });
  return true;
}

async function saveMafiaNickname(sender, nickname, groupId) {
  const cleanNickname = String(nickname || "").trim();
  if (cleanNickname.length < 2 || cleanNickname.length > 40) {
    return { ok: false, message: "❌ لقب المافيا يجب أن يكون بين 2 و40 حرفًا." };
  }

  await upsertMafiaPlayerIdentity(sender, groupId, {
    nickname: cleanNickname,
    awaitingNickname: false
  });
  await updatePendingJoinedPlayers(sender, cleanNickname);

  return { ok: true, message: `✅ تم حفظ لقبك للمافيا: ${cleanNickname}` };
}

async function updatePendingJoinedPlayers(sender, nickname) {
  const identity = buildIdentity(sender);
  const playerData = buildSessionPlayer(sender, nickname);
  const sessions = await MafiaSession.find({
    gameType: "mafia",
    status: "collecting_players",
    $or: [
      { "players.jid": identity.jid || normalizeJid(sender) },
      ...(identity.lid ? [{ "players.lid": identity.lid }] : []),
      ...(identity.rawLid ? [{ "players.rawLid": identity.rawLid }] : []),
      ...(identity.phoneNumber ? [{ "players.phoneNumber": identity.phoneNumber }] : [])
    ]
  });

  for (const session of sessions) {
    const index = findSessionPlayerIndex(session, sender);
    if (index === -1) continue;

    const existing = typeof session.players[index].toObject === "function"
      ? session.players[index].toObject()
      : session.players[index];
    session.players[index] = {
      ...existing,
      ...playerData,
      nickname
    };
    session.markModified("players");
    await session.save();
  }
}

async function getActiveSession(groupId) {
  return MafiaSession.findOne({
    groupId,
    gameType: "mafia",
    status: { $in: ACTIVE_STATUSES }
  }).sort({ createdAt: -1 });
}

async function isGroupAdmin(sock, groupId, sender) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const senderId = normalizeJid(sender);
    const participant = metadata.participants.find((item) => normalizeJid(item.id) === senderId);
    return Boolean(participant?.admin);
  } catch (error) {
    return false;
  }
}

function isSessionHostIdentifier(session, sender) {
  const identity = buildIdentity(sender);
  return (
    normalizeJid(session.hostJid) === normalizeJid(sender) ||
    (identity.jid && normalizeJid(session.hostJid) === identity.jid) ||
    (identity.lid && session.hostLid === identity.lid) ||
    (identity.rawLid && session.hostRawLid === identity.rawLid) ||
    (identity.phoneNumber && session.hostPhoneNumber === identity.phoneNumber)
  );
}

async function canControlSession(sock, session, sender) {
  return isSessionHostIdentifier(session, sender) || await isGroupAdmin(sock, session.groupId, sender);
}

function buildHostFields(sender, hostNickname) {
  const identity = buildIdentity(sender);
  return {
    hostJid: identity.jid || normalizeJid(sender),
    hostLid: identity.lid || identity.rawLid || null,
    hostRawLid: identity.rawLid || null,
    hostPhoneNumber: identity.phoneNumber || null,
    hostIdentifierType: identity.identifierType,
    hostNickname: hostNickname || hostMention(sender)
  };
}

function buildHostSessionQuery(sender) {
  const identity = buildIdentity(sender);
  const clauses = [];
  if (identity.jid) clauses.push({ hostJid: identity.jid });
  if (identity.lid) clauses.push({ hostLid: identity.lid });
  if (identity.rawLid) clauses.push({ hostRawLid: identity.rawLid });
  if (identity.phoneNumber) clauses.push({ hostPhoneNumber: identity.phoneNumber });
  clauses.push({ hostJid: normalizeJid(sender) });
  return { $or: clauses };
}

function getReadyJoinedPlayers(session) {
  return (session.players || []).filter((player) => player.nickname && !isSessionHostIdentifier(session, player.jid));
}

function getPendingJoinedPlayers(session) {
  return (session.players || []).filter((player) => !player.nickname && player.jid && !isSessionHostIdentifier(session, player.jid));
}

async function createCollectingPlayersSession(previousSession) {
  return MafiaSession.create({
    groupId: previousSession.groupId,
    gameType: "mafia",
    status: "collecting_players",
    configStep: "mafiaCount",
    hostJid: previousSession.hostJid,
    hostLid: previousSession.hostLid,
    hostRawLid: previousSession.hostRawLid,
    hostPhoneNumber: previousSession.hostPhoneNumber,
    hostIdentifierType: previousSession.hostIdentifierType,
    hostNickname: previousSession.hostNickname
  });
}

async function joinMafiaSession(sock, session, sender) {
  if (isSessionHostIdentifier(session, sender)) {
    await sock.sendMessage(session.groupId, { text: "🎭 الراوي لا يدخل كلاعب في المافيا." });
    return;
  }

  const existingIndex = findSessionPlayerIndex(session, sender);
  const savedPlayer = await findMafiaPlayerByJid(sender);
  const nickname = savedPlayer?.nickname || null;

  if (existingIndex !== -1) {
    if (nickname && !session.players[existingIndex].nickname) {
      session.players[existingIndex] = {
        ...buildSessionPlayer(sender, nickname),
        role: null,
        alive: true
      };
      session.markModified("players");
      await session.save();
    }

    await sock.sendMessage(session.groupId, {
      text: nickname
        ? `✅ أنت مسجل ضمن لاعبي المافيا: ${nickname}`
        : "✅ تم تسجيل انضمامك. أرسلت لك خاص لتثبيت لقب المافيا."
    });
    if (!nickname) await promptMafiaNicknameRegistration(sock, sender, session.groupId);
    return;
  }

  session.players.push(buildSessionPlayer(sender, nickname));
  session.markModified("players");
  await session.save();

  if (!nickname) {
    await promptMafiaNicknameRegistration(sock, sender, session.groupId);
    await sock.sendMessage(session.groupId, {
      text: `✅ تم تسجيل انضمامك يا ${hostMention(sender)}.\nأرسلت لك خاص لتثبيت لقب المافيا.`,
      mentions: [sender]
    });
    return;
  }

  await sock.sendMessage(session.groupId, {
    text: `✅ انضم ${hostMention(sender)} إلى المافيا باسم: ${nickname}`,
    mentions: [sender]
  });
}

export async function handleMafiaCommand(sock, jid, sender, text) {
  const trimmed = String(text || "").trim();

  if (isGroupJid(jid) && JOIN_COMMAND_PATTERN.test(trimmed)) {
    const session = await getActiveSession(jid);
    if (!session || session.status !== "collecting_players") return false;

    await joinMafiaSession(sock, session, sender);
    return true;
  }

  if (isGroupJid(jid) && START_SETUP_PATTERN.test(trimmed)) {
    const session = await getActiveSession(jid);
    if (!session || session.status !== "collecting_players") return false;

    if (!await canControlSession(sock, session, sender)) {
      await sock.sendMessage(jid, { text: "❌ فقط الراوي أو أدمن القروب يمكنه بدء إعداد المافيا." });
      return true;
    }

    const readyPlayers = getReadyJoinedPlayers(session);
    const pendingPlayers = getPendingJoinedPlayers(session);
    if (pendingPlayers.length) {
      await sock.sendMessage(jid, {
        text: `⚠️ يوجد لاعبون لم يثبتوا ألقابهم بعد:\n${pendingPlayers.map((player) => `• ${hostMention(player.jid)}`).join("\n")}\n\nبعد التسجيل اكتب /ابدأ_مافيا.`,
        mentions: pendingPlayers.map((player) => player.jid).filter(Boolean)
      });
      return true;
    }

    if (readyPlayers.length < 2) {
      await sock.sendMessage(jid, { text: "❌ تحتاج لاعبين اثنين على الأقل غير الراوي قبل بدء الإعداد." });
      return true;
    }

    session.status = "collecting_config";
    session.configStep = "mafiaCount";
    await session.save();

    await sock.sendMessage(session.hostJid, {
      text: `أنت الراوي للعبة المافيا 🎭

اللاعبون المشاركون: ${readyPlayers.length}

أرسل عدد لاعبي المافيا.
مثال:
2`
    });
    await sock.sendMessage(jid, { text: "✅ تم إغلاق الانضمام. أرسلت إعدادات الأدوار للراوي في الخاص." });
    return true;
  }

  if (isGroupJid(jid) && /^(لعب مرة أخرى|اعادة|إعادة)$/i.test(trimmed)) {
    const session = await getActiveSession(jid);
    if (!session || session.status !== "game_over") return false;

    if (!await canControlSession(sock, session, sender)) {
      await sock.sendMessage(jid, { text: "❌ فقط الراوي أو أدمن القروب يمكنه بدء جولة مافيا جديدة." });
      return true;
    }

    await closeSession(session);
    await createCollectingPlayersSession(session);
    await sock.sendMessage(jid, {
      text: `تم فتح جولة مافيا جديدة 🎭
الراوي هو: ${hostMention(session.hostJid)}

اللي بده يلعب يكتب:
انضم

وعندما يكتمل اللاعبون يكتب الراوي:
/ابدأ_مافيا`,
      mentions: [session.hostJid]
    });
    return true;
  }

  if (isGroupJid(jid) && /^(إنهاء الجلسة|انهاء الجلسة)$/i.test(trimmed)) {
    const session = await getActiveSession(jid);
    if (!session) return false;

    if (!await canControlSession(sock, session, sender)) {
      await sock.sendMessage(jid, { text: "❌ فقط الراوي أو أدمن القروب يمكنه إنهاء جلسة المافيا." });
      return true;
    }

    await closeSession(session);
    await sock.sendMessage(jid, {
      text: `تم إنهاء جلسة المافيا ✅
تم حذف بيانات الجولة، وتم الاحتفاظ بأسماء اللاعبين للجولات القادمة.`
    });
    return true;
  }

  if (["/مافيا", "مافيا", "لعبة مافيا", "لعبه مافيا", "mafia"].includes(trimmed.toLowerCase())) {
    if (!isGroupJid(jid)) {
      await sock.sendMessage(jid, { text: "❌ بدء لعبة المافيا يعمل داخل القروبات فقط." });
      return true;
    }

    const active = await getActiveSession(jid);
    if (active) {
      await sock.sendMessage(jid, { text: "⚠️ توجد لعبة مافيا فعالة في هذا القروب." });
      return true;
    }

    const hostPlayer = await findMafiaPlayerByJid(sender);
    const hostFields = buildHostFields(sender, hostPlayer?.nickname);
    await MafiaSession.create({
      groupId: jid,
      gameType: "mafia",
      status: "collecting_players",
      configStep: "mafiaCount",
      ...hostFields
    });

    await sock.sendMessage(jid, {
      text: `تم فتح لعبة المافيا 🎭
الراوي هو: ${hostMention(sender)}

اللي بده يلعب يكتب:
انضم

إذا ما عندك لقب مافيا، سأرسل لك خاص لتثبيته.

عندما يكتمل اللاعبون يكتب الراوي:
/ابدأ_مافيا`,
      mentions: [sender]
    });
    return true;
  }

  if (trimmed === "/انهاء_مافيا") {
    const session = await getActiveSession(jid);
    if (!session) {
      await sock.sendMessage(jid, { text: "لا توجد جلسة مافيا فعالة." });
      return true;
    }

    if (!await canControlSession(sock, session, sender)) {
      await sock.sendMessage(jid, { text: "❌ فقط الراوي أو أدمن القروب يمكنه إنهاء جلسة المافيا." });
      return true;
    }

    await closeSession(session);
    await sock.sendMessage(jid, {
      text: `تم إنهاء جلسة المافيا ✅
تم حذف بيانات الجولة، وتم الاحتفاظ بأسماء اللاعبين للجولات القادمة.`
    });
    return true;
  }

  if (["/فوز_المواطنين", "/فوز_مافيا", "/فوز_المافيا"].includes(trimmed)) {
    const session = await getActiveSession(jid);
    if (!session) {
      await sock.sendMessage(jid, { text: "لا توجد جلسة مافيا فعالة." });
      return true;
    }

    if (!await canControlSession(sock, session, sender)) {
      await sock.sendMessage(jid, { text: "❌ فقط الراوي أو أدمن القروب يمكنه إعلان نتيجة المافيا." });
      return true;
    }

    const winner = trimmed === "/فوز_المواطنين" ? "citizens" : "mafia";
    await announceGameOver(sock, session, winner);
    return true;
  }

  return false;
}

export async function handleMafiaHostPrivateFlow(sock, jid, sender, text) {
  if (isGroupJid(jid)) return false;

  const session = await MafiaSession.findOne({
    ...buildHostSessionQuery(sender),
    gameType: "mafia",
    status: { $in: ACTIVE_STATUSES }
  }).sort({ createdAt: -1 });

  if (!session) return false;

  const trimmed = String(text || "").trim();

  if (session.status === "game_over") {
    if (/^(1|لعب مرة أخرى|اعادة|إعادة|play again)$/i.test(trimmed)) {
      await closeSession(session);
      const newSession = await createCollectingPlayersSession(session);
      await sock.sendMessage(session.groupId, {
        text: `تم فتح جولة مافيا جديدة 🎭
الراوي هو: ${hostMention(session.hostJid)}

اللي بده يلعب يكتب:
انضم

وعندما يكتمل اللاعبون يكتب الراوي:
/ابدأ_مافيا`,
        mentions: [session.hostJid]
      });
      await sock.sendMessage(jid, { text: "تمام. فتحت باب الانضمام للجولة الجديدة في القروب." });
      return Boolean(newSession);
    }

    if (/^(2|إنهاء الجلسة|انهاء الجلسة|انهاء|end)$/i.test(trimmed)) {
      await closeSession(session);
      await sock.sendMessage(session.groupId, {
        text: `تم إنهاء جلسة المافيا ✅
تم حذف بيانات الجولة، وتم الاحتفاظ بأسماء اللاعبين للجولات القادمة.`
      });
      await sock.sendMessage(jid, { text: "✅ تم إنهاء جلسة المافيا." });
      return true;
    }

    await sock.sendMessage(jid, { text: "اكتب 1 للعب مرة أخرى أو 2 لإنهاء الجلسة." });
    return true;
  }

  if (session.status !== "collecting_config") return false;

  if (session.configStep === "mafiaCount") {
    const count = Number(trimmed);
    if (!Number.isInteger(count) || count < 1) {
      await sock.sendMessage(jid, { text: "❌ عدد المافيا يجب أن يكون رقمًا صحيحًا لا يقل عن 1.\nكم عدد لاعبي المافيا؟" });
      return true;
    }

    session.mafiaCount = count;
    session.configStep = "sheikh";
    await session.save();
    await sock.sendMessage(jid, { text: "هل تريد إضافة الشيخ؟\nرد بـ نعم أو لا." });
    return true;
  }

  if (session.configStep === "sheikh") {
    const answer = yesNo(trimmed);
    if (answer === null) {
      await sock.sendMessage(jid, { text: "رد بـ نعم أو لا.\nهل تريد إضافة الشيخ؟" });
      return true;
    }

    session.enabledRoles.sheikh = answer;
    session.configStep = "girl";
    session.markModified("enabledRoles");
    await session.save();
    await sock.sendMessage(jid, { text: "هل تريد إضافة البنت؟\nرد بـ نعم أو لا." });
    return true;
  }

  if (session.configStep === "girl") {
    const answer = yesNo(trimmed);
    if (answer === null) {
      await sock.sendMessage(jid, { text: "رد بـ نعم أو لا.\nهل تريد إضافة البنت؟" });
      return true;
    }

    session.enabledRoles.girl = answer;
    session.configStep = "boy";
    session.markModified("enabledRoles");
    await session.save();
    await sock.sendMessage(jid, { text: "هل تريد إضافة الولد؟\nرد بـ نعم أو لا." });
    return true;
  }

  if (session.configStep === "boy") {
    const answer = yesNo(trimmed);
    if (answer === null) {
      await sock.sendMessage(jid, { text: "رد بـ نعم أو لا.\nهل تريد إضافة الولد؟" });
      return true;
    }

    session.enabledRoles.boy = answer;
    session.configStep = "done";
    session.markModified("enabledRoles");
    await session.save();
    await distributeRoles(sock, session);
    return true;
  }

  return false;
}

async function getSelectedPlayablePlayers(session) {
  return getReadyJoinedPlayers(session).map((player) => ({
    jid: player.jid,
    lid: player.lid || null,
    rawLid: player.rawLid || null,
    phoneNumber: player.phoneNumber || null,
    identifierType: player.identifierType,
    nickname: player.nickname,
    role: null,
    alive: true
  }));
}

function optionalRolesCount(enabledRoles) {
  return Number(Boolean(enabledRoles?.sheikh)) + Number(Boolean(enabledRoles?.girl)) + Number(Boolean(enabledRoles?.boy));
}

async function distributeRoles(sock, session) {
  const playablePlayers = await getSelectedPlayablePlayers(session);
  const optionalCount = optionalRolesCount(session.enabledRoles);
  const total = playablePlayers.length;

  if (session.mafiaCount < 1 || session.mafiaCount >= total || session.mafiaCount + optionalCount > total) {
    session.mafiaCount = null;
    session.enabledRoles = { sheikh: false, girl: false, boy: false };
    session.configStep = "mafiaCount";
    session.markModified("enabledRoles");
    await session.save();

    await sock.sendMessage(session.hostJid, {
      text: `❌ الإعداد غير صالح.
اللاعبون المسجلون المتاحون: ${total}
المافيا يجب أن تكون 1 على الأقل وأقل من عدد اللاعبين، والأدوار الاختيارية لا تتجاوز العدد.

أرسل عدد لاعبي المافيا من جديد.`
    });
    return;
  }

  const shuffled = shuffle(playablePlayers);
  const assignedPlayers = [];
  let cursor = 0;

  for (let index = 0; index < session.mafiaCount; index++) {
    assignedPlayers.push({ ...shuffled[cursor++], role: ROLE_LABELS.mafia });
  }

  if (session.enabledRoles.sheikh) assignedPlayers.push({ ...shuffled[cursor++], role: ROLE_LABELS.sheikh });
  if (session.enabledRoles.girl) assignedPlayers.push({ ...shuffled[cursor++], role: ROLE_LABELS.girl });
  if (session.enabledRoles.boy) assignedPlayers.push({ ...shuffled[cursor++], role: ROLE_LABELS.boy });

  while (cursor < shuffled.length) {
    assignedPlayers.push({ ...shuffled[cursor++], role: ROLE_LABELS.civilian });
  }

  session.players = assignedPlayers;
  session.status = "roles_distributed";
  session.winner = null;
  await session.save();

  const failedMessages = [];
  for (const player of assignedPlayers) {
    try {
      await sock.sendMessage(player.jid, {
        text: `دورك في لعبة المافيا هو: ${player.role} ${ROLE_ICONS[player.role] || ""}`.trim()
      });
    } catch (error) {
      failedMessages.push(player.nickname);
    }
  }

  let hostList = "قائمة الأدوار:\n\n";
  for (const player of assignedPlayers) {
    hostList += `${player.nickname}: ${player.role}\n`;
  }
  if (failedMessages.length) {
    hostList += `\nتعذر إرسال الدور إلى: ${failedMessages.join(", ")}`;
  }

  await sock.sendMessage(session.hostJid, { text: hostList.trim() });
  await sock.sendMessage(session.groupId, {
    text: `تم توزيع أدوار لعبة المافيا ✅
الراوي هو: ${hostMention(session.hostJid)}

ابدأوا اللعبة في الواقع، والراوي معه قائمة الأدوار.`,
    mentions: [session.hostJid]
  });
}

async function announceGameOver(sock, session, winner) {
  session.status = "game_over";
  session.winner = winner;
  await session.save();

  const winnerLabel = winner === "mafia" ? "المافيا 🕵️‍♂️" : "المواطنين 👥";
  const groupMessage = `انتهت لعبة المافيا 🎭

الفائزون: ${winnerLabel}

يا راوي، اكتب:
- لعب مرة أخرى
- إنهاء الجلسة`;

  const privateMessage = `انتهت لعبة المافيا 🎭

الفائزون: ${winnerLabel}

ماذا تريد أن تفعل؟

1. لعب مرة أخرى
2. إنهاء الجلسة`;

  await sock.sendMessage(session.groupId, { text: groupMessage });
  await sock.sendMessage(session.hostJid, { text: privateMessage });
}

async function closeSession(session) {
  session.status = "closed";
  session.players = [];
  session.winner = null;
  session.mafiaCount = null;
  session.enabledRoles = { sheikh: false, girl: false, boy: false };
  session.configStep = "mafiaCount";
  session.closedAt = new Date();
  session.markModified("enabledRoles");
  await session.save();
}
