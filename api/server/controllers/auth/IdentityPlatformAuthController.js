const { identityPlatformAuthEnabled } = require('~/server/services/IdentityPlatformService');
const {
  callStaraApiPublic,
  normalizeEmail,
  safeString,
} = require('~/server/services/StaraServiceClient');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ERROR_STATUSES = new Set([400, 403, 404, 409, 410, 429, 503]);
const envEnabled = (value) => /^(1|true|yes|on)$/i.test(String(value ?? '').trim());

const checkIdentityPlatformSignupEligibility = async (req, res) => {
  if (!identityPlatformAuthEnabled() || !envEnabled(process.env.ALLOW_REGISTRATION)) {
    return res.status(404).json({ error: 'not_found' });
  }

  const email = normalizeEmail(req.body?.email);
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      error: 'invalid_email',
      message: 'Enter a valid email address.',
    });
  }
  const inviteToken = safeString(req.body?.invite_token, undefined, 512);

  try {
    const result = await callStaraApiPublic('/v1/signup/eligibility', {
      method: 'POST',
      body: {
        email,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = ALLOWED_ERROR_STATUSES.has(error.status) ? error.status : 502;
    return res.status(status).json({
      error: safeString(error.code, 'signup_eligibility_unavailable'),
      message: safeString(error.message, 'Signup eligibility could not be verified.', 300),
    });
  }
};

module.exports = { checkIdentityPlatformSignupEligibility };
