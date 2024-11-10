import path from 'path';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { faker } from '@faker-js/faker';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';

const ownerId = 888352;
const userCount = 120;
const actionCount = 20000;
const giftList = [{
  order: 1,
  image: 'delicious-cake',
  color: 'FE9F41',
  name: { en: 'Delicious Cake', ru: 'Вкусный торт' },
  price: 10,
  asset: 'USDT',
  total: 500,
  sold: 0,
}, {
  order: 2,
  image: 'green-star',
  color: '46D100',
  name: { en: 'Green Star', ru: 'Зелёная звезда' },
  price: 5,
  asset: 'TON',
  total: 3000,
  sold: 0,
}, {
  order: 3,
  image: 'blue-star',
  color: '007AFF',
  name: { en: 'Blue Star', ru: 'Синяя звезда' },
  price: 0.01,
  asset: 'ETH',
  total: 5000,
  sold: 0,
}, {
  order: 4,
  image: 'red-star',
  color: 'FF4747',
  name: { en: 'Red Star', ru: 'Красная звезда' },
  price: 0.01,
  asset: 'ETH',
  total: 10000,
  sold: 0,
}];

// DANGER: this script will fully replace the current DB if it exists!

dotenv.config({ path: path.join(__dirname, '.env') });
const mongo: MongoClient = new MongoClient(`mongodb://${process.env.MONGO_HOST}/`);
mongo.connect().then(async client => {
  const db = client.db(process.env.MONGO_DB);
  const gifts = db.collection('gifts');
  await gifts.deleteMany();
  for (const gift of giftList) {
    gift['anim'] = readFileSync(`anim/gift-${gift.image}.json`, 'utf-8');
    const result = await gifts.insertOne(gift);
    gift['_id'] = result.insertedId;
  }
  await gifts.createIndex({ order: 1 });

  const rand = (await (await fetch(`https://randomuser.me/api/?inc=name,picture&results=${userCount}&noinfo`)).json()).results;
  const users = db.collection('users');
  await users.deleteMany();
  const userList: any[] = [];
  for (let i = 0; i < userCount; i++) {
    const user = {
      _id: (i == userCount - 1 ? ownerId : Math.round(Math.random() * 1e12)) as any,
      firstName: rand[i].name.first,
      lastName: Math.random() > 0.3 ? rand[i].name.last : null,
      photo: Math.random() > 0.1 ? Buffer.from(await (await fetch(rand[i].picture.large)).arrayBuffer()) : null,
      premium: Math.random() > 0.5,
      theme: Math.random() > 0.5 ? 'day' : 'night',
      locale: Math.random() > 0.5 ? 'ru' : 'en',
      gifts: 0,
    };
    await users.insertOne(user);
    userList.push(user);
  }
  await users.createIndex({ gifts: -1 });
  const actions = db.collection('actions');
  await actions.deleteMany();
  const actionList: any = [];
  for (let i = 0; i < actionCount; i++) {
    const gift = giftList[Math.floor((0.99 - Math.pow(Math.random(), 3) * 0.99) * giftList.length)];
    const receiver = userList[Math.floor(Math.pow(Math.random(), 2) * userList.length)];
    const action = {
      date: faker.date.recent({ days: 10 }),
      type: ['buy', 'send'][Math.floor(Math.random() * 2)],
      userId: userList[Math.floor(Math.random() * userList.length)]['_id'],
      giftId: gift['_id'],
    }
    if (action.type == 'buy') {
      action['code'] = nanoid(16);
      action['price'] = gift.price;
      action['asset'] = gift.asset;
      if (gift.sold >= gift.total) {
        continue; // Sold out
      }
      gift.sold++;
    } else
    if (action.type == 'send') {
      action['receiverId'] = receiver['_id'];
      actionList.push({ // Also add a receive event
        date: action.date,
        type: 'receive',
        userId: action['receiverId'],
        giftId: action.giftId,
        senderId: action.userId,
      });
      receiver.gifts++;
    }
    actionList.push(action);
  }
  for (const gift of giftList) {
    await gifts.updateOne({ _id: gift['_id'] }, {
      $set: { sold: gift.sold },
    });
  }
  for (const user of userList) {
    await users.updateOne({ _id: user['_id'] }, {
      $set: { gifts: user.gifts },
    });
  }
  actionList.sort((a0, a1) => a0.date.getTime() - a1.date.getTime());
  await actions.insertMany(actionList);
  await actions.createIndex({ type: 1, code: 1, invoiceId: 1, userId: 1, senderId: 1, receiverId: 1, giftId: 1 });
  console.log('Done');
  await mongo.close();
  process.exit();
});