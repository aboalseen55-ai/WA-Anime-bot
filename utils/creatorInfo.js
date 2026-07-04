const CREATOR_NAME = "سام آل جابر";
const CREATOR_PHONE = "+962795137282";

const CREATOR_QUESTION_PATTERN =
  /(من|مين|مَن)\s+(صنعك|برمجك|مبرمجك|طورك|مطورك|سواك|عملك|انشأك|أنشأك)|((من|مين|مَن)\s+(المبرمج|المطور|صاحب\s+البوت))|(who\s+(made|created|programmed|developed)\s+you)/i;

export function isCreatorQuestion(text) {
  return typeof text === "string" && CREATOR_QUESTION_PATTERN.test(text.trim());
}

export function getCreatorInfoMessage() {
  return `تمت برمجتي وتطويري بواسطة ${CREATOR_NAME}.\nرقم التواصل: ${CREATOR_PHONE}`;
}
