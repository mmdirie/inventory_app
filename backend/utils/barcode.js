function createEan13Candidate() {
  const payload = `890${Math.floor(100000000 + Math.random() * 900000000)}`;
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${payload}${checkDigit}`;
}

module.exports = { createEan13Candidate };
