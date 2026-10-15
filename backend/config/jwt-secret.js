const secret = (process.env.JWT_SECRET || '').trim();

if (!/^[a-f0-9]{64}$/i.test(secret)) {
  throw new Error('JWT_SECRET must be a 64-character hexadecimal value generated from 32 random bytes.');
}

module.exports = secret;
