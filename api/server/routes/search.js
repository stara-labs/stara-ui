const express = require('express');
const { isEnabled } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { staraNativeRuntimeEnabled } = require('~/server/services/StaraNativeRuntime');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/enable', async function (req, res) {
  if (!isEnabled(process.env.SEARCH)) {
    return res.send(false);
  }

  if (staraNativeRuntimeEnabled()) {
    return res.send(true);
  }

  try {
    const { MeiliSearch } = require('meilisearch');
    const client = new MeiliSearch({
      host: process.env.MEILI_HOST,
      apiKey: process.env.MEILI_MASTER_KEY,
    });

    const { status } = await client.health();
    return res.send(status === 'available');
  } catch {
    return res.send(false);
  }
});

module.exports = router;
