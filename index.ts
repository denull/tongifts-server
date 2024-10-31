
import path from 'node:path';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import TelegramBotAPI from '@denull/tg-bot-api';
import { fmt } from 'tg-format';
import { loc } from './locales';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const bot: any = new TelegramBotAPI(process.env.TELEGRAM_TOKEN);
const mongo = new MongoClient(`mongodb://${process.env.MONGO_HOST}/`);

function validateInitData(initData): any {
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

  function upsertUser(user) {
    return users.findOneAndUpdate(
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
  }
  async function findAllGifts() {
    return (await gifts.find().sort('order', 'asc')).toArray();
  }
  function findUser(id: number) {
    return users.findOne({ _id: id as any });
  }
  async function findTopUsers() {
    return (await users.find().sort('gifts', 'desc').limit(100)).toArray();
  }
  function findMyPosition(me) {
    return users.countDocuments({ gifts: { $gt: me.gifts || 0 } });
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
          photo: `${process.env.SERVER_URL}/img/logo-640x360.png`,
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
  app.post('/api/gifts', async (req, res) => { // All available in store gifts
    res.json(await findAllGifts());
  });
  app.post('/api/gifts/:gift/history', async (req, res) => { // Latest actions for a specific gift
    res.json();
  });
  app.post('/api/gifts/:gift/buy', async (req, res) => { // Buy gift
    res.json();
  });
  app.post('/api/gifts/:gift/send', async (req, res) => { // Send gift
    res.json();
  });
  app.post('/api/leaderboard', async (req, res) => { // Current standing
    res.json(await findTopUsers());
  });
  app.post('/api/users/:id/gifts', async (req, res) => { // List of gifts received by specific user
    res.json();
  });
  app.post('/api/inventory', async (req, res) => { // List of gifts we bought (but not sent yet)
    res.json();
  });
  app.post('/api/actions', async (req, res) => { // List of our actions
    res.json();
  });
  app.post('/api/init', async (req, res) => {
    const initData = validateInitData(req.body.initData);
    if (!initData) {
      res.status(401).end();
      return;
    }
    const [me, gifts, leaderboard] = await Promise.all([
      findUser(initData.user?.id),
      findAllGifts(),
      findTopUsers(),
    ]);
    me && (me.position = await findMyPosition(me));
    let inventory, received; // TODO
    res.json({ me, gifts, inventory, leaderboard, received });
  });
  
  app.listen(process.env.SERVER_PORT, () => {
    console.log('Server started');
  });
});