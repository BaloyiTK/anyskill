// src/utils/otp.js
export const generateOTP = () => {
  const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit code
  return otp.toString();
};