// src/utils/sendEmail.js
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export const sendEmail = async (to, subject, text) => {
  try {
    const info = await transporter.sendMail({
      from: `"OTP Verification" <tiyanikevinbaloyi@gmail.com>`,
      to: to,
      subject: subject,
      text: text
    });

    console.log("Email sent:", info.response);
  } catch (error) {
    console.error("Email send error:", error.message);
    throw error;
  }
};