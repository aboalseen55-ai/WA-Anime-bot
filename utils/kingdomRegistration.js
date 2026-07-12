import Kingdom from "../database/kingdomModel.js";
import KingdomRegistrationSession from "../database/kingdomRegistrationSessionModel.js";
import { resolveMentionContext } from "../commands/adminSystem.js";
import {
  buildKingdomsReport,
  consumeKingdomAccessCode,
  createKingdomFromRegistration,
  generateKingdomAccessCode,
  isDeveloper,
  isGroupJid,
  normalizeGroupJid
} from "./kingdomService.js";
import { DEVELOPER_JID } from "../config.js";

const GROUP_ROLE_OPTIONS = [
  {
    key: "mainGroup",
    number: "1",
    label: "المجموعة الأساسية",
    prompt: "أرسل JID المجموعة الأساسية.\nمثال: 120363xxxxxxxx@g.us"
  },
  {
    key: "receptionGroup",
    number: "2",
    label: "مجموعة الاستقبال",
    prompt: "أرسل JID مجموعة الاستقبال."
  },
  {
    key: "workGroup",
    number: "3",
    label: "مجموعة الترحيب/الوورك",
    prompt: "أرسل JID مجموعة الترحيب أو الوورك."
  },
  {
    key: "adminGroup",
    number: "4",
    label: "مجموعة الإدارة",
    prompt: "أرسل JID مجموعة الإدارة."
  },
  {
    key: "extraGroup",
    number: "5",
    label: "مجموعة إضافية",
    prompt: "أرسل JID المجموعة الإضافية."
  }
];

const STEPS = {
  name: {
    next: "groupCount",
    label: "اسم المملكة",
    prompt: "اكتب اسم المملكة أو النقابة كما سيظهر للأعضاء.\nمثال: مملكة كلوفر"
  },
  groupCount: {
    next: "groupRoles",
    label: "عدد القروبات",
    prompt: "كم قروب في المملكة؟\nاكتب رقمًا مثل 3 أو كلمة مثل ثلاث."
  },
  groupRoles: {
    next: "groupJid",
    label: "أنواع القروبات",
    prompt: buildGroupRolesPrompt(1)
  },
  groupJid: {
    next: "bankStartingBalance",
    label: "JID القروب",
    prompt: "أرسل JID القروب المطلوب."
  },
  bankStartingBalance: {
    next: "confirm",
    label: "رصيد البنك الابتدائي",
    prompt: "أرسل رصيد البنك الابتدائي بالأرقام، أو اكتب: تخطي لاعتماد 1000000."
  },
  confirm: {
    next: null,
    label: "التأكيد",
    prompt: "اكتب تأكيد لإنشاء المملكة، أو إلغاء لإلغاء العملية."
  }
};

function isSkip(value) {
  return ["تخطي", "skip", "-", "لا"].includes(String(value || "").trim().toLowerCase());
}

function buildGroupRolesPrompt(count) {
  return `اختر أنواع القروبات وعددها ${count}.
أرسل الأرقام مفصولة بفواصل أو مسافات.

1. المجموعة الأساسية
2. مجموعة الاستقبال
3. مجموعة الترحيب/الوورك
4. مجموعة الإدارة
5. مجموعة إضافية

مثال: 1,2,3
لازم تختار المجموعة الأساسية رقم 1.`;
}

function parseGroupCount(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const digits = normalized.match(/\d+/)?.[0];
  if (digits) return Number(digits);

  const words = {
    "واحد": 1,
    "واحدة": 1,
    "قروب": 1,
    "مجموعة": 1,
    "اثنين": 2,
    "إثنين": 2,
    "اثنتين": 2,
    "ثنين": 2,
    "ثلاث": 3,
    "ثلاثة": 3,
    "اربع": 4,
    "أربع": 4,
    "اربعة": 4,
    "أربعة": 4,
    "خمس": 5,
    "خمسة": 5,
    "ست": 6,
    "ستة": 6,
    "سبع": 7,
    "سبعة": 7,
    "ثمان": 8,
    "ثمانية": 8,
    "تسع": 9,
    "تسعة": 9,
    "عشر": 10,
    "عشرة": 10
  };

  if (words[normalized]) return words[normalized];

  for (const token of normalized.split(/\s+/)) {
    if (words[token]) return words[token];
  }

  return null;
}

function parseGroupRoles(value, expectedCount) {
  const tokens = String(value || "")
    .split(/[\s,،]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const roles = [];
  const usedSpecificRoles = new Set();

  for (const token of tokens) {
    const option = GROUP_ROLE_OPTIONS.find((item) => item.number === token || item.label.includes(token));
    if (!option) {
      return { ok: false, message: `❌ لم أفهم نوع القروب: ${token}` };
    }

    if (option.key !== "extraGroup" && usedSpecificRoles.has(option.key)) {
      return { ok: false, message: `❌ لا يمكن تكرار ${option.label}.` };
    }

    if (option.key !== "extraGroup") usedSpecificRoles.add(option.key);
    roles.push({ ...option, index: roles.length + 1 });
  }

  if (roles.length !== expectedCount) {
    return { ok: false, message: `❌ اختر ${expectedCount} نوع/أنواع بالضبط.` };
  }

  if (!roles.some((role) => role.key === "mainGroup")) {
    return { ok: false, message: "❌ لازم تختار المجموعة الأساسية رقم 1." };
  }

  return { ok: true, roles };
}

function getCurrentGroupRole(data) {
  return data.groupRoles?.[data.currentGroupIndex || 0];
}

function formatGroupLines(data) {
  const lines = [];
  if (data.mainGroup) lines.push(`الأساسية: ${data.mainGroup}`);
  if (data.receptionGroup) lines.push(`الاستقبال: ${data.receptionGroup}`);
  if (data.workGroup) lines.push(`الترحيب/الوورك: ${data.workGroup}`);
  if (data.adminGroup) lines.push(`الإدارة: ${data.adminGroup}`);
  for (const [index, groupJid] of (data.extraGroupIds || []).entries()) {
    lines.push(`إضافية ${index + 1}: ${groupJid}`);
  }
  return lines.length ? lines.join("\n") : "-";
}

function getAllGroupJids(data) {
  return [
    data.mainGroup,
    data.receptionGroup,
    data.workGroup,
    data.adminGroup,
    ...(data.extraGroupIds || [])
  ].filter(Boolean);
}

function formatSessionSummary(data) {
  return `🏰 *مراجعة بيانات المملكة*

الاسم: ${data.name}
عدد القروبات: ${data.groupCount}
القروبات:
${formatGroupLines(data)}
رصيد البنك: ${data.bankStartingBalance}

اكتب *تأكيد* لإنشاء المملكة أو *إلغاء* لإلغاء العملية.`;
}

async function sendDeveloperCode(sock, generatedByJid, reason, mentions = []) {
  const { code } = await generateKingdomAccessCode(generatedByJid);
  await sock.sendMessage(DEVELOPER_JID, {
    text: `🔐 رمز فتح مملكة جديد\n\nالرمز: ${code}\nالسبب: ${reason}\n\nالرمز لا ينتهي بالوقت، لكنه يُستهلك عند استخدامه.`,
    mentions
  });
}

async function validateGroupAccess(sock, groupJid) {
  if (!groupJid) return { ok: true };

  try {
    await sock.groupMetadata(groupJid);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `تعذر قراءة بيانات القروب ${groupJid}: ${error.message}` };
  }
}

async function validateSessionValue(step, value) {
  const trimmed = String(value || "").trim();

  if (step === "name") {
    if (trimmed.length < 2 || trimmed.length > 80) {
      return { ok: false, message: "❌ اسم المملكة يجب أن يكون بين 2 و80 حرفًا." };
    }
    return { ok: true, value: trimmed };
  }

  if (step === "groupCount") {
    const count = parseGroupCount(trimmed);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      return { ok: false, message: "❌ عدد القروبات يجب أن يكون من 1 إلى 10." };
    }
    return { ok: true, value: count };
  }

  if (step === "groupJid") {
    const groupJid = normalizeGroupJid(trimmed);
    if (!isGroupJid(groupJid)) {
      return { ok: false, message: "❌ JID القروب غير صحيح. يجب أن ينتهي بـ @g.us" };
    }

    const existing = await Kingdom.findOne({
      $or: [
        { mainGroup: groupJid },
        { receptionGroup: groupJid },
        { adminGroup: groupJid },
        { workGroup: groupJid },
        { groupIds: groupJid }
      ]
    });
    if (existing) {
      return { ok: false, message: `❌ هذا القروب مربوط مسبقًا بمملكة: ${existing.name}` };
    }

    return { ok: true, value: groupJid };
  }

  if (step === "bankStartingBalance") {
    if (isSkip(trimmed)) {
      return { ok: true, value: 1000000 };
    }

    const amount = Number(trimmed);
    if (!Number.isInteger(amount) || amount < 0) {
      return { ok: false, message: "❌ الرصيد يجب أن يكون رقمًا صحيحًا موجبًا أو صفر." };
    }
    return { ok: true, value: amount };
  }

  return { ok: true, value: trimmed };
}

export async function handleDeveloperKingdomCommand(sock, jid, sender, trimmedText) {
  const [command] = trimmedText.split(/\s+/);
  const developerCommands = ["/رمز_مملكة", "/رمز_نقابة", "/الممالك", "/تقرير_الممالك"];
  if (!developerCommands.includes(command)) return false;

  if (!isDeveloper(sender)) {
    await sock.sendMessage(jid, { text: "❌ هذا الأمر خاص بالمطور فقط." });
    return true;
  }

  if (command === "/رمز_مملكة" || command === "/رمز_نقابة") {
    await sendDeveloperCode(sock, sender, "طلب مباشر من المطور");
    if (jid !== DEVELOPER_JID) {
      await sock.sendMessage(jid, { text: "✅ تم إرسال رمز فتح المملكة إلى الخاص بالمطور." });
    }
    return true;
  }

  const report = await buildKingdomsReport({ withMentions: true });
  await sock.sendMessage(jid, report);
  return true;
}

export async function handleStartKingdomRegistration(sock, jid, sender, trimmedText, msg) {
  const parts = trimmedText.split(/\s+/);
  const command = parts[0];
  if (command !== "/فتح_مملكة" && command !== "/فتح_نقابة") {
    return false;
  }

  const code = parts[1];
  if (!code) {
    await sock.sendMessage(jid, { text: "❌ استخدم: /فتح_مملكة <الرمز>" });
    return true;
  }

  const existingSession = await KingdomRegistrationSession.findOne({ requesterJid: sender, status: "collecting" });
  if (existingSession) {
    const prompt = STEPS[existingSession.currentStep]?.prompt || "اكتب إلغاء ثم ابدأ من جديد.";
    await sock.sendMessage(jid, { text: `⚠️ لديك عملية فتح مملكة غير مكتملة.\n${prompt}` });
    return true;
  }

  const codeDoc = await consumeKingdomAccessCode(code, sender);
  if (!codeDoc) {
    await sock.sendMessage(jid, { text: "❌ الرمز غير صحيح أو تم استخدامه مسبقًا." });
    return true;
  }

  const actor = await resolveMentionContext(sender);
  await sendDeveloperCode(sock, sender, `تم استخدام الرمز السابق بواسطة ${actor.text}`, actor.mentions);

  await KingdomRegistrationSession.create({
    codeId: codeDoc._id,
    requesterJid: sender,
    requesterName: msg?.pushName || null,
    currentStep: "name",
    data: {
      ownerJid: sender,
      createdByName: msg?.pushName || null
    }
  });

  await sock.sendMessage(jid, {
    text: `✅ تم قبول الرمز وبدأت عملية فتح المملكة.\n\n${STEPS.name.prompt}\n\nلإلغاء العملية اكتب: إلغاء`
  });
  return true;
}

export async function handleKingdomRegistrationStep(sock, jid, sender, text) {
  const session = await KingdomRegistrationSession.findOne({ requesterJid: sender, status: "collecting" });
  if (!session) return false;

  const trimmed = String(text || "").trim();
  if (!trimmed) return true;

  if (/^(إلغاء|الغاء|cancel)$/i.test(trimmed)) {
    session.status = "cancelled";
    await session.save();
    await sock.sendMessage(jid, { text: "✅ تم إلغاء عملية فتح المملكة." });
    return true;
  }

  if (session.currentStep === "confirm") {
    if (!/^تأكيد$/i.test(trimmed)) {
      await sock.sendMessage(jid, { text: STEPS.confirm.prompt });
      return true;
    }

    const data = session.data || {};
    const accessChecks = await Promise.all(getAllGroupJids(data).map((groupJid) => validateGroupAccess(sock, groupJid)));

    const failedCheck = accessChecks.find((check) => !check.ok);
    if (failedCheck) {
      await sock.sendMessage(jid, { text: `❌ لا يمكن إنشاء المملكة الآن.\n${failedCheck.message}\n\nتأكد أن البوت مضاف في القروبات ثم اكتب تأكيد مرة أخرى.` });
      return true;
    }

    try {
      const kingdom = await createKingdomFromRegistration(data, sender, session.codeId);
      session.status = "completed";
      session.completedAt = new Date();
      await session.save();

      await sock.sendMessage(jid, { text: `✅ تم إنشاء ${kingdom.name} بنجاح.\nالمعرف: ${kingdom.id}` });
      const creator = await resolveMentionContext(sender, kingdom.id);
      await sock.sendMessage(DEVELOPER_JID, {
        text: `🏰 تم إنشاء مملكة جديدة\nالاسم: ${kingdom.name}\nالمعرف: ${kingdom.id}\nبواسطة: ${creator.text}`,
        mentions: creator.mentions
      });
    } catch (error) {
      await sock.sendMessage(jid, { text: `❌ فشل إنشاء المملكة: ${error.message}` });
    }
    return true;
  }

  const step = session.currentStep;
  const data = session.data || {};
  const validation = step === "groupRoles"
    ? parseGroupRoles(trimmed, data.groupCount)
    : await validateSessionValue(step, trimmed);
  if (!validation.ok) {
    const retryPrompt = step === "groupRoles" ? buildGroupRolesPrompt(data.groupCount) : STEPS[step].prompt;
    await sock.sendMessage(jid, { text: `${validation.message}\n\n${retryPrompt}` });
    return true;
  }

  if (step === "groupRoles") {
    data.groupRoles = validation.roles;
    data.currentGroupIndex = 0;
    session.currentStep = "groupJid";
    session.data = data;
    session.markModified("data");
    await session.save();

    const role = getCurrentGroupRole(data);
    await sock.sendMessage(jid, { text: `✅ تم حفظ أنواع القروبات.\n\n${role.prompt}` });
    return true;
  }

  if (step === "groupJid") {
    const role = getCurrentGroupRole(data);
    if (!role) {
      session.currentStep = "bankStartingBalance";
    } else {
      const existingInSession = getAllGroupJids(data).includes(validation.value);
      if (existingInSession) {
        await sock.sendMessage(jid, { text: `❌ هذا الـ JID مكرر داخل نفس المملكة.\n\n${role.prompt}` });
        return true;
      }

      if (role.key === "extraGroup") {
        data.extraGroupIds = [...(data.extraGroupIds || []), validation.value];
      } else {
        data[role.key] = validation.value;
      }

      data.currentGroupIndex = (data.currentGroupIndex || 0) + 1;
      if (data.currentGroupIndex < data.groupRoles.length) {
        const nextRole = getCurrentGroupRole(data);
        session.currentStep = "groupJid";
        session.data = data;
        session.markModified("data");
        await session.save();
        await sock.sendMessage(jid, { text: `✅ تم حفظ ${role.label}.\n\n${nextRole.prompt}` });
        return true;
      }

      session.currentStep = "bankStartingBalance";
    }
  } else {
    data[step] = validation.value;
    session.currentStep = STEPS[step].next;
  }

  session.data = data;
  session.markModified("data");
  await session.save();

  if (session.currentStep === "confirm") {
    await sock.sendMessage(jid, { text: formatSessionSummary(data) });
    return true;
  }

  const nextPrompt = session.currentStep === "groupRoles" ? buildGroupRolesPrompt(data.groupCount) : STEPS[session.currentStep].prompt;
  await sock.sendMessage(jid, { text: `✅ تم حفظ ${STEPS[step].label}.\n\n${nextPrompt}` });
  return true;
}
