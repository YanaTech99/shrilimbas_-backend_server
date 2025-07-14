const generateOTP = () => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 1000); // expires in 30 seconds

  return { otp, expiresAt };
};

export { generateOTP };
