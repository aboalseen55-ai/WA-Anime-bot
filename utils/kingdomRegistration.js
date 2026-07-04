import Kingdom from "../database/kingdomModel.js";
import KingdomRegistrationSession from "../database/kingdomRegistrationSessionModel.js";
import {
  buildKingdomsReport,
  consumeKingdomAccessCode,
  createKingdomFromRegistration,
  generateKingdomAccessCode,
  isDeveloper,
  isGroupJid,
  isValidKingdomId,
  normalizeGroupJid
} from "./kingdomService.js";
import { DEVELOPER_JID } from "../config.js";

const STEPS = {
  id: {
    next: "name",
    label: "معرف المملكة",
    prompt: "اكتب معرف المملكة بالإنجليزي فقط.\nمثال: clover أو golden_2"
  },
  name: {
    next: "mainGroup",
    label: "اسم المملكة",
    prompt: "اكتب اسم المملكة الظاهر للأعضاء.\nمثال: 🍀 مملكة كلوفر"
  },
  mainGroup: {
    next: "receptionGroup",
    label: "القروب الرئيسي",
    prompt: "أرسل JID القروب الرئيسي للمملكة.\nمثال: 120363xxxxxxxx@g.us"
  },
  receptionGroup: {
    next: "adminGroup",
    label: "قروب الاستقبال",
    prompt: "أرسل JID قروب الاستقبال، أو اكتب: تخطي"
  },
  adminGroup: {
    next: "workGroup",
    label: "قروب الإدارة",
    prompt: "أرسل JID قروب الإدارة، أو اكتب: تخطي"
  },
  workGroup: {
    next: "bankStartingBalance",
    label: "قروب الوورك",
    prompt: "أرسل JID قروب الوورك، أو اكتب: تخطي"
  },
  bankStartingBalance: {
    next: "confirm",
    label: "رصيد البنك الابتدائي",
    prompt: "أرسل رصيد البنك الابتدائي بالأرقام.\nمثال: 1000000"
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

function formatSessionSummary(data) {
  return `🏰 *مراجعة بيانات المملكة*

المعرف: ${data.id}
الاسم: ${data.name}
الرئيسي: ${data.mainGroup}
الاستقبال: ${data.receptionGroup || "-"}
الإدارة: ${data.adminGroup || "-"}
الوورك: ${data.workGroup || "-"}
رصيد البنك: ${data.bankStartingBalance}

اكتب *تأكيد* لإنشاء المملكة أو *إلغاء* لإلغاء العملية.`;
}

async function sendDeveloperCode(sock, generatedByJid, reason) {
  const { code } = await generateKingdomAccessCode(generatedByJid);
  await sock.sendMessage(DEVELOPER_JID, {
    text: `🔐 رمز فتح مملكة جديد\n\nالرمز: ${code}\nالسبب: ${reason}\n\nالرمز لا ينتهي بالوقت، لكنه يُستهلك عند استخدامه.`
  });
}

async function validateGroupAccess(sock, groupJid) {
  if (!groupJid) return { ok: true };

  try {
    const metadata = await sock.groupMetadata(groupJid);
    const botId = sock.user?.id?.split(":")[0];
    const botParticipant = metadata.participants.find((participant) => {
      const participantId = participant.id?.split(":")[0];
      return participantId === botId || participant.id === sock.user?.id;
    });

    if (!botParticipant) {
      return { ok: false, message: `البوت ليس عضوًا في ${groupJid}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: `تعذر قراءة بيانات القروب ${groupJid}: ${error.message}` };
  }
}

async function validateSessionValue(step, value) {
  const trimmed = String(value || "").trim();

  if (step === "id") {
    const id = trimmed.toLowerCase();
    if (!isValidKingdomId(id)) {
      return { ok: false, message: "❌ المعرف يجب أن يبدأ بحرف إنجليزي ويحتوي حروف/أرقام/_/- فقط، من 3 إلى 31 حرفًا." };
    }

    const existing = await Kingdom.findOne({ id });
    if (existing) {
      return { ok: false, message: "❌ هذا المعرف مستخدم لمملكة أخرى." };
    }

    return { ok: true, value: id };
  }

  if (step === "name") {
    if (trimmed.length < 2 || trimmed.length > 80) {
      return { ok: false, message: "❌ اسم المملكة يجب أن يكون بين 2 و80 حرفًا." };
    }
    return { ok: true, value: trimmed };
  }

  if (["mainGroup", "receptionGroup", "adminGroup", "workGroup"].includes(step)) {
    if (step !== "mainGroup" && isSkip(trimmed)) {
      return { ok: true, value: "" };
    }

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

  const report = await buildKingdomsReport();
  await sock.sendMessage(jid, { text: report });
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
    await sock.sendMessage(jid, { text: `⚠️ لديك عملية فتح مملكة غير مكتملة.\n${STEPS[existingSession.currentStep].prompt}` });
    return true;
  }

  const codeDoc = await consumeKingdomAccessCode(code, sender);
  if (!codeDoc) {
    await sock.sendMessage(jid, { text: "❌ الرمز غير صحيح أو تم استخدامه مسبقًا." });
    return true;
  }

  await sendDeveloperCode(sock, sender, `تم استخدام الرمز السابق بواسطة ${sender}`);

  await KingdomRegistrationSession.create({
    codeId: codeDoc._id,
    requesterJid: sender,
    requesterName: msg?.pushName || null,
    currentStep: "id",
    data: {
      ownerJid: sender,
      createdByName: msg?.pushName || null
    }
  });

  await sock.sendMessage(jid, {
    text: `✅ تم قبول الرمز وبدأت عملية فتح المملكة.\n\n${STEPS.id.prompt}\n\nلإلغاء العملية اكتب: إلغاء`
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
    const accessChecks = await Promise.all([
      validateGroupAccess(sock, data.mainGroup),
      validateGroupAccess(sock, data.receptionGroup),
      validateGroupAccess(sock, data.adminGroup),
      validateGroupAccess(sock, data.workGroup)
    ]);

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
      await sock.sendMessage(DEVELOPER_JID, { text: `🏰 تم إنشاء مملكة جديدة\nالاسم: ${kingdom.name}\nالمعرف: ${kingdom.id}\nبواسطة: ${sender}` });
    } catch (error) {
      await sock.sendMessage(jid, { text: `❌ فشل إنشاء المملكة: ${error.message}` });
    }
    return true;
  }

  const step = session.currentStep;
  const validation = await validateSessionValue(step, trimmed);
  if (!validation.ok) {
    await sock.sendMessage(jid, { text: `${validation.message}\n\n${STEPS[step].prompt}` });
    return true;
  }

  const data = session.data || {};
  data[step] = validation.value;
  session.data = data;
  session.markModified("data");
  session.currentStep = STEPS[step].next;
  await session.save();

  if (session.currentStep === "confirm") {
    await sock.sendMessage(jid, { text: formatSessionSummary(data) });
    return true;
  }

  await sock.sendMessage(jid, { text: `✅ تم حفظ ${STEPS[step].label}.\n\n${STEPS[session.currentStep].prompt}` });
  return true;
}
