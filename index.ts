
import path from 'node:path';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import express from 'express';
import { MongoClient } from 'mongodb';
import TelegramBotAPI from '@denull/tg-bot-api';
import { loc } from './locales';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const bot: any = new TelegramBotAPI(process.env.TELEGRAM_TOKEN);
const mongo = new MongoClient(`mongodb://${process.env.MONGO_HOST}/`);

const pageSize = 100;

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
  async function findAllGifts() {
    return (await gifts.find().sort('order', 'asc')).toArray();
  }
  function findUser(id: number) {
    return users.findOne({ _id: id as any }, { projection: ['firstName', 'lastName', 'gifts', 'premium', 'locale', 'theme'] });
  }
  async function findUserPhoto(id: number) {
    return (await users.findOne({ _id: id as any }, { projection: ['photo'] }))?.photo;
  }
  async function findTopUsers() {
    return (await users.find({}, { projection: ['firstName', 'lastName', 'gifts', 'premium'] }).sort('gifts', 'desc').limit(100)).toArray();
  }
  function findPosition(me) {
    return users.countDocuments({ gifts: { $gt: me.gifts || 0 } });
  }
  async function findInventory(id: number, offs: number = 0) {
    return (await actions.find({ userId: id, type: 'buy' }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
  }
  async function findReceivedGifts(id: number, offs: number = 0) {
    return (await actions.find({ receiverId: id, type: 'send' }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
  }
  async function findActions(id: number, offs: number = 0) {
    return (await actions.find({ userId: id }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
  }
  async function findGiftActions(gift, offs: number = 0) {
    return (await actions.find({ giftId: gift, type: { $in: ['buy', 'send'] } }).sort('_id', 'desc').skip(offs).limit(pageSize)).toArray();
  }

  //bot.sendMessage({ chat_id: 888352, ...fmt`Test` });
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
      console.log(user);
      if (message.text == '/start') {
        bot.sendPhoto({
          chat_id: message.chat.id,
          photo: `${process.env.SERVER_URL}/assets/logo-640x360.png`,
          ...loc('en', 'startMessage').toObject('caption', 'caption_entities'),
          reply_markup: {
            inline_keyboard: [[{
              text: loc('en', 'btnOpenApp'),
              web_app: {
                url: process.env.SERVER_URL,
              }
            }]]
          }
        });
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
    res.json(await findGiftActions(req.params.gift, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
  });
  app.post('/api/gifts/:gift/buy', async (req, res) => { // Buy gift
    // TODO: create invoice using crypto bot api
    res.json();
  });
  app.post('/api/gifts/:gift/send', async (req, res) => { // Send gift
    // TODO: send
    res.json();
  });
  app.post('/api/leaderboard', async (req, res) => { // Current standing
    res.json(await findTopUsers());
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
    res.json(await findActions(req.init.user.id, isNaN(parseInt(req.query.offs)) ? 0 : parseInt(req.query.offs)));
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
    res.json({ me, gifts, inventory, leaderboard, received });
  });
  app.get('/api/user/:id/photo.jpg', async (req, res) => {
    const photo = await findUserPhoto(parseInt(req.params.id));
    if (!photo) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(photo.buffer);
  });
  app.listen(process.env.SERVER_PORT, () => {
    console.log('Server started');
  });
});