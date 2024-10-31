
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import TelegramBotAPI from '@denull/tg-bot-api';
import { fmt } from 'tg-format';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const bot = new TelegramBotAPI(process.env.TELEGRAM_TOKEN);

//bot.sendMessage({ chat_id: 888352, ...fmt`Test` });