// 脱敏处理：屏蔽手机号、身份证号、邮箱等敏感信息，
// 用于向用户展示处理结果时避免泄露内部跟进细节。
export const maskSensitiveInfo = (text: string): string => {
  return text
    .replace(/1[3-9]\d{9}/g, '***********')
    .replace(/\b\d{17}[\dXx]\b/g, '******************')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***');
};
