
import path from 'node:path';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import TelegramBotAPI from '@denull/tg-bot-api';
import { loc } from './locales';
import { createHash, createHmac } from 'crypto';
import { WebSocketServer } from 'ws';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const bot: any = new TelegramBotAPI(process.env.TELEGRAM_TOKEN);
const mongo = new MongoClient(`mongodb://${process.env.MONGO_HOST}/`);

const pageSize = 24;
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

mongo.connect().then(client => {
  const db = client.db(process.env.MONGO_DB);
  const gifts = db.collection('gifts');
  const users = db.collection('users');
  const actions = db.collection('actions');

  async function upsertUser(user) {
    const result: any = await users.findOneAndUpdate(
      { _id: user.id },
      {
        $set: {
          firstName: user.first_name,
          lastName: user.last_name,
          premium: !!user.is_premium
        },
        $setOnInsert: { // Do not override if user changed it
          locale: user.language_code?.startsWith('ru') ? 'ru' : 'en',
          theme: null,
          gifts: 0,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (!result.photoTs || Date.now() - result.photoTs > 30 * 60 * 1000) {
      // Time to refresh userpic (note: this is a longer operation, it won't affect current result)
      users.updateOne({ _id: user.id }, { $set: { photoTs: Date.now() }}).then(async () => {
        const chat = await bot.getChat({ chat_id: user.id });
        if (result.photoId == chat.photo?.small_file_id) {
          // Not changed
          return;
        }
        if (!chat.photo?.small_file_id) {
          // Empty photo
          users.updateOne({ _id: user.id }, { $set: { photoId: null, photo: null } });
          return;
        }
        // Store big photo as well?
        const file = await bot.getFile({ file_id: chat.photo.small_file_id });
        users.updateOne({ _id: user.id }, { $set: {
          photoId: chat.photo.small_file_id,
          photo: Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`)).arrayBuffer()),
        } });
      });
    }
    return result;
  }
  async function updateInvoicePaid(invoiceId) {
    const action = await actions.findOneAndUpdate({ invoiceId }, { $set: { type: 'buy' } }, { returnDocument: 'after' });
    if (!action) {
      return null;
    }
    await gifts.updateOne({ _id: action.giftId }, { $inc: { sold: 1 }});
    return action;
  }
  async function findAllGifts() {
    return (await gifts.find().sort('order', 'asc')).toArray();
  }
  function findStoreGift(giftId: ObjectId) {
    return gifts.findOne({ _id: giftId });
  }
  function findUser(id: number) {
    return users.findOne({ _id: id as any }, { projection: {
      firstName: 1,
      lastName: 1,
      gifts: 1,
      premium: 1,
      hasPhoto: {
        $ne: ['$photo', null],
      },
      locale: 1,
      theme: 1,
    } });
  }
  async function findUserPhoto(id: number) {
    return (await users.findOne({ _id: id as any }, { projection: ['photo'] }))?.photo;
  }
  async function findTopUsers() {
    return (await users.find({}, { projection: {
      firstName: 1,
      lastName: 1,
      gifts: 1,
      premium: 1,
      hasPhoto: {
        $ne: ['$photo', null],
      },
    } }).sort('gifts', 'desc').limit(100)).toArray();
  }
  async function findUsers(ids: number[]) {
    return (await users.find({ _id: { $in: ids as any }}, { projection: {
      firstName: 1,
      lastName: 1,
      gifts: 1,
      premium: 1,
      hasPhoto: {
        $ne: ['$photo', null],
      },
    } }).sort('gifts', 'desc').limit(100)).toArray();
  }
  function findPosition(user) {
    return users.countDocuments({ gifts: { $gt: user.gifts || 0 } });
  }
  async function findBoughtGift(userId, id) {
    return actions.findOne({ _id: id, userId, type: 'buy' });
  }
  async function findInventory(userId: number, offs: number = 0) {
    return (await actions.find({ userId, type: 'buy' }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
  }
  
  async function findActions(query, offs: number = 0) {
    const list = await (await actions.find(query).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
    if (list.length) {
      const users = await findUsers([...new Set(
        list.map(action => action.userId).filter(id => !!id).concat(
          list.map(action => action.senderId).filter(id => !!id),
          list.map(action => action.receiverId).filter(id => !!id),
        ))]);
      const usersMap = Object.fromEntries(users.map(user => [user._id, user]));
      for (const action of list) {
        action.userId && (action['user'] = usersMap[action.userId]);
        action.senderId && (action['sender'] = usersMap[action.senderId]);
        action.receiverId && (action['receiver'] = usersMap[action.receiverId]);
      }
    }
    return list;
  }
  function findReceivedGifts(id: number, offs: number = 0) {
    return findActions({ userId: id, type: 'receive' }, offs);
  }
  function findRecentActions(id: number, offs: number = 0) {
    return findActions({ userId: id, type: { $in: ['buy', 'send', 'receive'] } }, offs);
  }
  function findGiftActions(gift, offs: number = 0) {
    return findActions({ giftId: gift, type: { $in: ['buy', 'send'] } }, offs);
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
      const user = await upsertUser(message.from);
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
      if (inlineQuery.query && !inlineQuery.query.match(/^[a-f0-9]{24}$/)) {
        bot.answerInlineQuery({
          inline_query_id: inlineQuery.id,
          is_personal: true,
        });
        return;
      }
      const user = await upsertUser(inlineQuery.from);
      const allGifts = Object.fromEntries((await findAllGifts()).map(gift => [gift._id, gift]));
      const gifts = inlineQuery.query ? [await findBoughtGift(
        user.id,
        ObjectId.createFromHexString(inlineQuery.query),
      )].filter(gift => !!gift) : await findInventory(inlineQuery.from.id);
      //console.log(allGifts);
      bot.answerInlineQuery({
        inline_query_id: inlineQuery.id,
        is_personal: true,
        results: gifts.map(gift => ({
          type: 'article',
          id: gift._id.toHexString(),
          title: loc(user.locale, 'btnSendGift'),
          description: loc(user.locale, 'sendGiftOf')(allGifts[gift.giftId].name[user.locale]),
          thumbnail_url: `${process.env.SERVER_URL}/assets/logo-300x300.png`,
          thumbnail_width: 300,
          thumbnail_height: 300,
          input_message_content: {
            ...loc(user.locale, 'giftMessage').toObject('message_text', 'entities'),
          },
          reply_markup: {
            inline_keyboard: [[{
              text: loc(user.locale, 'btnReceiveGift'),
              url: `https://t.me/${process.env.TELEGRAM_USERNAME}/app?startapp=receive_${gift._id}`,
            }]]
          }
        })),
      })
    }
  });
  app.post('/cryptopay', async (req, res) => {
    if (!checkCryptoPaySignature(process.env.CRYPTOPAY_TOKEN, req)) {
      res.status(401).end();
      return;
    }
    console.log(req.body);
    if (req.body.update_type == 'invoice_paid') {
      const invoice = req.body.payload;
      const action = await updateInvoicePaid(invoice.id);
      if (invoiceSockets[invoice.id]) { // Notify client and close connection
        invoiceSockets[invoice.id].send(JSON.stringify({ status: 'paid' }));
        invoiceSockets[invoice.id].close();
        delete invoiceSockets[invoice.id];
      }
    }
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
    res.json(await findGiftActions(ObjectId.createFromHexString(req.params.gift), isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
  });
  app.post('/api/gifts/:gift/buy', async (req, res) => { // Buy gift
    if (!req.params.gift.match(/^[a-f0-9]{24}$/)) {
      res.status(401).end();
      return;
    }
    const gift = await findStoreGift(ObjectId.createFromHexString(req.params.gift));
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
        //paid_btn_name: 'callback',
        payload: gift._id.toString(),
      }),
    })).json();
    if (!result.ok) {
      console.error(result);
      res.status(500).end();
      return;
    }
    await actions.insertOne({
      date: new Date(),
      type: 'invoice',
      userId: user!._id,
      giftId: gift._id,
    });
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
    res.json(await findReceivedGifts(parseInt(req.params.id, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs))));
  });
  app.post('/api/inventory', async (req, res) => { // List of gifts we bought (but not sent yet)
    res.json(await findInventory(req.init.user.id, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
  });
  app.post('/api/actions', async (req, res) => { // List of our actions
    res.json(await findRecentActions(req.init.user.id, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
  });
  app.post('/api/init', async (req, res) => {
    const myId = req.init.user?.id;
    const [me, gifts, inventory, leaderboard, received] = await Promise.all([
      findUser(myId),
      findAllGifts(),
      findInventory(myId),
      findTopUsers(),
      findReceivedGifts(myId),
    ]);
    me && (me.position = await findPosition(me));

    const result = { me, gifts, inventory, leaderboard, received };
    if (req.init.start_param) {
      const params = req.init.start_param.split('_');
      if (params[0] == 'receive') {
        // TODO: add a 'receive' action
        result['giftReceived'] = {};
      }
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
  
  const wss = new WebSocketServer({ port: process.env.WEBSOCKET_PORT });
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
  app.listen(process.env.SERVER_PORT, () => {
    console.log('Server started');
  });
});