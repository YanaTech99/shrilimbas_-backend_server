import validator from "validator";
import xss from "xss";

const sanitizeInput = (input) => {
  if (typeof input === "string") {
    // Trim, remove dangerous HTML/JS, and escape dangerous characters
    return validator.escape(xss(input.trim()));
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return input; // Safe primitives
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeInput(item));
  }

  if (input !== null && typeof input === "object") {
    const sanitizedObject = {};
    for (const key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        sanitizedObject[key] = sanitizeInput(input[key]);
      }
    }
    return sanitizedObject;
  }

  return input; // null, undefined, or unsupported types
};

const validateUserInput = ({ username, email, phone }) => {
  const errors = {};

  // Username: alphanumeric, 3–20 chars, underscores allowed, must start with a letter
  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

  // Email: standard email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // Phone: accepts international format with optional +, 10–15 digits
  const phoneRegex = /^\+?[0-9]{10,15}$/;

  // Username check
  if (username && !usernameRegex.test(username)) {
    errors.username =
      "Invalid username. Use 3–20 letters/numbers/underscores, must start with a letter.";
  }

  // Email check
  if (email && !emailRegex.test(email)) {
    errors.email = "Invalid email address.";
  }

  // Phone check
  if (phone && !phoneRegex.test(phone)) {
    errors.phone = "Invalid phone number. Use 10–15 digits, with optional +.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export { sanitizeInput, validateUserInput };
