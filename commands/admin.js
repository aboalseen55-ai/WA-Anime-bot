import User from "../database/userModel.js";
import { ADMINS } from "../config.js";

export async function adminCommands(sock, jid, sender, text) {

  if (!ADMINS.includes(sender)) return;

  const args = text.trim().split(" ");
  const command = args[0];

  // عرض المستخدمين
  if (command === "/مستخدمين") {
    const users = await User.find({});
    if (!users.length) {
      await sock.sendMessage(jid, { text: "لا يوجد مستخدمين مسجلين." });
      return;
    }

    let msg = "📋 قائمة المستخدمين:\n\n";
    users.forEach((u, i) => {
      msg += `${i + 1}- لقب: ${u.nickname}\nID: ${u.jid}\n💰 نقاط: ${u.points || 0}\n\n`;
    });

    await sock.sendMessage(jid, { text: msg });
  }

  // تغيير لقب مستخدم
  if (command === "/تغييرلقب") {
    const target = args[1];
    const nick = args.slice(2).join(" ");
    if (!target || !nick) {
      await sock.sendMessage(jid, {
        text: "الاستخدام:\n/تغييرلقب (اللقب القديم أو الرقم) اللقب الجديد"
      });
      return;
    }

    // البحث عن المستخدم بـ jid أو اللقب القديم
    let user = await User.findOne({ jid: target });
    if (!user) {
      user = await User.findOne({ nickname: target });
    }

    if (!user) {
      await sock.sendMessage(jid, { text: "المستخدم غير موجود." });
      return;
    }

    // التحقق من أن اللقب الجديد غير مستخدم
    const existingUser = await User.findOne({ nickname: nick });
    if (existingUser && existingUser.nickname !== user.nickname) {
      await sock.sendMessage(jid, { text: `❌ هذا اللقب مستخدم بالفعل!` });
      return;
    }

    user.nickname = nick;
    await user.save();
    await sock.sendMessage(jid, { text: `✅ تم تغيير اللقب إلى ${nick}` });
  }

  // حذف مستخدم نهائيًا
  if (command === "/حذفمستخدم") {
    const target = args[1];
    if (!target) {
      await sock.sendMessage(jid, { text: "الاستخدام:\n/حذفمستخدم (اللقب أو الرقم)" });
      return;
    }

    // البحث عن المستخدم بـ jid أو اللقب
    let user = await User.findOne({ jid: target });
    if (!user) {
      user = await User.findOne({ nickname: target });
    }

    if (!user) {
      await sock.sendMessage(jid, { text: "المستخدم غير موجود." });
      return;
    }

    await User.deleteOne({ nickname: user.nickname });
    await sock.sendMessage(jid, { text: `✅ تم حذف المستخدم نهائيًا.` });
  }

}