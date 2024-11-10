
import path from 'node:path';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import express from 'express';
import TelegramBotAPI from '@denull/tg-bot-api';
import { loc, locales } from './locales';
import { createHash, createHmac } from 'crypto';
import { WebSocketServer } from 'ws';
import { initDb, upsertUser, updateInvoicePaid,
  updateGiftReceived, insertInvoice,
  findAllGifts, findReadyToSendGift, findGiftActions,
  findInventory, findPosition, findReceivedGifts,
  findRecentActions, findStoreGift, findTopUsers,
  findUser, findUserPhoto,
  updateGiftSent,
  updateUser,
  findUsersByName
} from './db';

dotenv.config({ path: path.join(__dirname, '.env') });
const bot: any = new TelegramBotAPI(process.env.TELEGRAM_TOKEN);
const invoiceSockets = {};

function validateInitData(initData): any {
  if (process.env.DEV && initData === '') {
    return { user: { id: 888352, first_name: 'Denis' } };
  }
  const data = {};
  const raw = {};
  let hash;
  for (let line of initData.split('&')) {
    const pair = line.split('=');
    if (pair.length == 2) {
      const key = decodeURIComponent(pair[0]);
      const value = decodeURIComponent(pair[1]);
      if (key == 'hash') {
        hash = value;
      } else {
        raw[key] = value;
        data[key] = (key == 'user') ? JSON.parse(value) : value;
      }
    }
  }
  const keys = Object.keys(data);
  keys.sort();

  const list: string[] = [];
  for (let key of keys) {
    list.push(`${key}=${raw[key]}`);
  }
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_TOKEN as string).digest();
  const correctHash = crypto.createHmac('sha256', secretKey).update(list.join('\n')).digest('hex');
  
  if (correctHash != hash) {
    return null;
  }
  return data;
}

function checkCryptoPaySignature(token, { body, headers }) {
  const secret = createHash('sha256').update(token).digest()
  const checkString = JSON.stringify(body)
  const hmac = createHmac('sha256', secret).update(checkString).digest('hex')
  return hmac === headers['crypto-pay-api-signature'];
}

const app: any = express();
app.use(express.json());
app.use('/', express.static('public'));

bot.setWebhook({ url: `${process.env.SERVER_URL}/webhook`, secret_token: process.env.SERVER_SECRET });

app.post('/webhook', async (req, res) => {
  if (req.headers['x-telegram-bot-api-secret-token'] != process.env.SERVER_SECRET) {
    res.status(401).end();
    return;
  }
  res.send({ ok: true });

  if (req.body.message) {
    const message = req.body.message;
    const user = await upsertUser(bot, message.from);
    //console.log(user);
    if (message.text == '/start') {
      bot.sendPhoto({
        chat_id: message.chat.id,
        photo: `${process.env.SERVER_URL}/assets/logo-640x360.png`,
        ...loc(user.locale, 'startMessage').toObject('caption', 'caption_entities'),
        reply_markup: {
          inline_keyboard: [[{
            text: loc(user.locale, 'btnOpenApp'),
            web_app: {
              url: process.env.SERVER_URL,
            }
          }]]
        }
      });
    }
  } else
  if (req.body.inline_query) {
    const inlineQuery = req.body.inline_query;
    if (inlineQuery.query && !inlineQuery.query.match(/^[a-zA-Z0-9_-]{16}$/)) {
      bot.answerInlineQuery({
        inline_query_id: inlineQuery.id,
        is_personal: true,
      });
      return;
    }
    const user = await upsertUser(bot, inlineQuery.from);
    const allGifts = Object.fromEntries((await findAllGifts()).map(gift => [gift._id, gift]));
    const gifts = inlineQuery.query ? [await findReadyToSendGift(
      inlineQuery.query,
    )].filter(gift => !!gift) : await findInventory(inlineQuery.from.id);
    //console.log(allGifts);
    bot.answerInlineQuery({
      inline_query_id: inlineQuery.id,
      is_personal: true,
      cache_time: 0,
      results: gifts.map(gift => ({
        type: 'article',
        id: gift._id.toHexString(),
        title: loc(user.locale, 'btnSendGift'),
        description: loc(user.locale, 'sendGiftOf')(allGifts[gift.giftId.toString()].name[user.locale]),
        //thumbnail_url: `${process.env.SERVER_URL}/assets/logo-300x300.png`,
        //thumbnail_width: 300,
        //thumbnail_height: 300,
        thumbnail_url: `${process.env.SERVER_URL}/assets/gift/${allGifts[gift.giftId.toString()].image}.png`,
        thumbnail_width: 512,
        thumbnail_height: 512,
        input_message_content: {
          ...loc(user.locale, 'giftMessage').toObject('message_text', 'entities'),
        },
        reply_markup: {
          inline_keyboard: [[{
            text: loc(user.locale, 'btnReceiveGift'),
            url: `https://t.me/${process.env.TELEGRAM_USERNAME}/app?startapp=${gift.code}`,
          }]]
        }
      })),
    })
  } else
  if (req.body.chosen_inline_result) {
    const result = req.body.chosen_inline_result;
    await updateGiftSent(result.result_id, result.inline_message_id); 
  }
});
app.post('/cryptopay', async (req, res) => {
  console.log('recv cryptopay webhook', req.body, req.headers);
  if (!checkCryptoPaySignature(process.env.CRYPTOPAY_TOKEN, req)) {
    res.status(401).end();
    return;
  }
  //console.log(req.body);
  if (req.body.update_type == 'invoice_paid') {
    const invoice = req.body.payload;
    console.log('updating action');
    const action = await updateInvoicePaid(invoice.invoice_id);
    if (invoiceSockets[invoice.invoice_id]) { // Notify client and close connection
      invoiceSockets[invoice.invoice_id].send(JSON.stringify({ status: 'paid', action }));
      invoiceSockets[invoice.invoice_id].close();
      delete invoiceSockets[invoice.invoice_id];
    }
  }
  res.json({ ok: true });
});

app.use('/api/*', (req, res, next) => {
  const initData = validateInitData(req.body.initData);
  if (!initData) {
    res.status(401).end();
    return;
  }
  req.init = initData;
  next();
});
app.post('/api/gifts', async (req, res) => { // All available in store gifts
  res.json(await findAllGifts());
});
app.post('/api/gifts/:gift/history', async (req, res) => { // Latest actions for a specific gift
  res.json(await findGiftActions(req.params.gift, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
});
app.post('/api/gifts/:gift/buy', async (req, res) => { // Buy gift
  if (!req.params.gift.match(/^[a-f0-9]{24}$/)) {
    res.status(401).end();
    return;
  }
  const gift = await findStoreGift(req.params.gift);
  if (!gift) {
    res.status(404).end();
    return;
  }
  const user = await findUser(req.init.user.id);
  const result = await (await fetch(`${process.env.CRYPTOPAY_URL}/api/createInvoice`, {
    method: 'POST',
    headers: {
      'Crypto-Pay-API-Token': process.env.CRYPTOPAY_TOKEN as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      currency_type: 'crypto',
      asset: gift.asset,
      amount: gift.price,
      description: loc(user!.locale, 'invoiceText')(gift.name[user!.locale]),
      payload: gift._id.toString(),
    }),
  })).json();
  if (!result.ok) {
    console.error(result);
    res.status(500).end();
    return;
  }
  await insertInvoice(user!._id, result.result.invoice_id, gift._id, gift.price, gift.asset);
  res.json({
    id: result.result.invoice_id,
    url: result.result.mini_app_invoice_url,
  });
});
app.post('/api/gifts/:gift/send', async (req, res) => { // Send gift
  // TODO: send
  res.json();
});
app.post('/api/leaderboard', async (req, res) => { // Current standing
  res.json(await findTopUsers());
});
app.post('/api/users/:id', async (req, res) => { // Return user
  if (isNaN(parseInt(req.params.id))) {
    res.status(400).end();
    return;
  }
  const user = await findUser(parseInt(req.params.id));
  if (!user) {
    res.status(404).end();
    return;
  }
  res.json(Object.assign(user, { position: await findPosition(user) }));
});
app.post('/api/users/:id/gifts', async (req, res) => { // List of gifts received by specific user
  if (isNaN(parseInt(req.params.id))) {
    res.status(400).end();
    return;
  }
  res.json(await findReceivedGifts(parseInt(req.params.id), isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
});
app.post('/api/inventory', async (req, res) => { // List of gifts we bought (but not sent yet)
  res.json(await findInventory(req.init.user.id, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
});
app.post('/api/actions', async (req, res) => { // List of our actions
  res.json(await findRecentActions(req.init.user.id, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
});
app.post('/api/search', async (req, res) => {
  res.json(await findUsersByName(req.body.query, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
});
app.post('/api/settings', async (req, res) => { // Update settings
  const update = {};
  if ('theme' in req.body) {
    if (!['day', 'night'].includes(req.body.theme)) {
      res.status(400).end();
      return;
    }
    update['theme'] = req.body.theme;
  }
  if ('locale' in req.body) {
    if (!Object.keys(locales).includes(req.body.locale)) {
      res.status(400).end();
      return;
    }
    update['locale'] = req.body.locale;
  }
  if (!Object.keys(update).length) {
    res.status(400).end();
    return;
  }
  await updateUser(req.init.user.id, update);
  res.json({ ok: true });
});
app.post('/api/init', async (req, res) => {
  await upsertUser(bot, req.init.user);

  const myId = req.init.user?.id;
  let giftReceived;
  if (req.init.start_param) {
    giftReceived = await updateGiftReceived(req.init.start_param, myId);
    if (giftReceived?.buy) {
      const sender = (await findUser(giftReceived.buy.userId))!;
      bot.editMessageText({
        inline_message_id: giftReceived.buy.inlineId,
        ...loc(sender.locale, 'giftMessageReceived'),
        reply_markup: {
          inline_keyboard: [[{
            text: loc(sender.locale, 'btnOpenApp'),
            url: `https://t.me/${process.env.TELEGRAM_USERNAME}/app`,
          }]]
        }
      });
      delete giftReceived.buy;
    }
  }

  const [me, gifts, inventory, leaderboard, received] = await Promise.all([
    findUser(myId),
    findAllGifts(),
    findInventory(myId),
    findTopUsers(),
    findReceivedGifts(myId),
  ]);
  me && (me.position = await findPosition(me));

  const result = { me, gifts, inventory, leaderboard, received };
  if (giftReceived) {
    result['gift'] = giftReceived;
  }
  
  res.json(result);
});
app.get('/user/:id/photo.jpg', async (req, res) => {
  const photo = await findUserPhoto(parseInt(req.params.id));
  if (!photo) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(photo.buffer);
});

const wss = new WebSocketServer({ port: process.env.WEBSOCKET_PORT as any });
wss.on('connection', (ws) => {
  let invoiceId;
  ws.on('error', console.error);
  ws.on('message', (data) => {
    data = JSON.parse(data);
    // TODO: validate init/invoice
    invoiceId = data.invoiceId;
    invoiceSockets[invoiceId] = ws;
  });
  ws.on('close', () => {
    if (invoiceId) {
      delete invoiceSockets[invoiceId];
    }
  });
});

// Start the server
initDb().then(() => {
  console.log('Database connected');
  app.listen(process.env.SERVER_PORT, () => {
    console.log('Server started');
  });
});