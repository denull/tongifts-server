import { fmt } from 'tg-format';

function num(locale, n, opts) {
  if (locale == 'en') {
    if (n == 0) return opts[0];
    if (n == 1) return opts[1];
    return cs[2];
  } else
  if (locale == 'ru') {
    if (n == 0) return opts[0];
    n = n % 100;
    if ((n % 10 == 0) || (n % 10 > 4) || (n > 4 && n < 21) || (n % 1 != 0)) {
      return cs[3];
    }
    if (n % 10 == 1) return cs[1];
    return cs[2];
  }
  return opts[0];
}
function fmtNum(num) {
  if (num < 1e3) {
    return num;
  }
  if (num < 1e6) {
    return Math.floor(num / 1e3) + 'K';
  }
  return Math.floor(num / 1e6) + 'M';
}

export const locales = {
  en: {
    store: 'Store',
    gifts: 'Gifts',
    leaderboard: 'Leaderboard',
    profile: 'Profile',

    btnClose: 'Close',
    btnBuyGift: 'Buy a Gift',
    btnSoldOut: 'Sold Out',
    btnPay: 'Pay',
    btnSendGift: 'Send Gift',
    btnSendToContact: 'Send Gift to Contact',
    btnReceiveGift: 'Receive Gift',
    btnOpenStore: 'Open Store',
    btnView: 'View',
    btnSend: 'Send',
    btnOpenApp: 'Open App',
    btnOpenGifts: 'Open Gifts',

    sendGiftOf: gift => `Send a gift of ${gift}`,
    gift: 'Gift',
    sender: 'From',
    date: 'Date',
    price: 'Price',
    availability: 'Availability',
    search: 'Search',
    numGifts: count => num('en', count, ['no gifts received', `${count} gift received`, `${count} gifts received`]),
    numGiftsShort: count => num('en', count, ['no gifts', `${count} gift`, `${count} gifts`]),
    countOf: ({ n, total }) => `${fmtNum(n)} of ${fmtNum(total)}`,
    from: 'from',
    to: 'to',
    dateFormat: date => date.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }) + ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric' }),
    you: 'You',
    startMessage: fmt`🎁 Here you can buy and send gifts to your friends.`,
    receivedMessage: ({ name, gift }) => fmt`👌 ${[name, 'bold']} received your gift of ${[gift, 'bold']}.`,
    purchasedMessage: gift => fmt`✅ You have purchased the gift of ${[gift, 'bold']}.`,
    giftMessage: fmt`🎁 I have a ${['gift', 'bold']} for you! Tap the button below to open it.`,
    giftMessageReceived: fmt`🎁 Gift received`,
    recentActions: 'Recent Actions',
    invoiceText: gift => `Purchasing a ${gift} gift`,

    action_buy: 'Bought',
    action_send: 'Sent',
    action_receive: 'Received',

    profileEmpty: 'You can buy a gift to receive a gift in return.',
    storeTitle: 'Buy and Send Gifts',
    storeSubtitle: 'Unique gifts for everyone by Crypto Pay.',
    giftsTitle: 'Send Gifts in Telegram',
    giftsSubtitle: 'Send gifts to users that can be stored in their app profile.',
    giftsEmpty: 'You don\'t have any gifts yet.',
    actionsTitle: 'Recent Actions',
    actionsSubtitle: 'Here is your action history.',
    actionsEmptyTitle: 'History is Empty',
    actionsEmptySubtitle: 'Give and receive gifts so there\'s something here.',
    giftReceivedTitle: 'Gift Received',
    giftReceivedSubtitle: gift => `You have received the gift ${gift}.`,
    giftBoughtTitle: 'You Bought a Gift',
    giftBoughtSubtitle: 'Now send it to your friend.',
    purchasedTitle: 'Gift Purchased',
    purchasedSubtitle: ({ gift, price, asset }) => `The ${gift} gift was purchased for ${price} ${asset}.`,
  },
  ru: {
    store: 'Магазин',
    gifts: 'Подарки',
    leaderboard: 'Рейтинг',
    profile: 'Профиль',

    btnClose: 'Закрыть',
    btnBuyGift: 'Купить подарок',
    btnSoldOut: 'Распродано',
    btnPay: 'Оплатить',
    btnSendGift: 'Отправить подарок',
    btnSendToContact: 'Отправить подарок контакту',
    btnReceiveGift: 'Получить подарок',
    btnOpenStore: 'Открыть Магазин',
    btnView: 'Показать',
    btnSend: 'Отправить',
    btnOpenApp: 'Открыть приложение',
    btnOpenGifts: 'Открыть подарки',

    sendGiftOf: gift => `Отправить подарок «${gift}»`,
    gift: 'Подарок',
    sender: 'Отправитель',
    date: 'Дата',
    price: 'Цена',
    availability: 'Количество',
    search: 'Поиск',
    numGifts: count => num('ru', count, ['получено 0 подарков', `получен ${count} подарок`, `получено ${count} подарка`, `получено ${count} подарков`]),
    numGiftsShort: count => num('ru', count, ['0 подарков', `${count} подарок`, `${count} подарка`, `${count} подарков`]),
    countOf: ({ n, total }) => `${fmtNum(n)} из ${fmtNum(total)}`,
    from: 'отпр.',
    to: 'получ.',
    dateFormat: date => date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'numeric', day: 'numeric' }) + ' в ' + date.toLocaleTimeString('ru-RU', { hour: 'numeric', minute: 'numeric' }),
    you: 'Вы',
    startMessage: fmt`🎁 Здесь вы можете покупать и отправлять подарки своим друзьям.`,
    receivedMessage: ({ name, gift }) => fmt`👌 ${[name, 'bold']} получил(а) ваш подарок «${[gift, 'bold']}».`,
    purchasedMessage: gift => fmt`✅ Вы купили подарок «${[gift, 'bold']}».`,
    giftMessage: fmt`🎁 У меня для тебя есть ${['подарок', 'bold']}! Нажми кнопку ниже, чтобы открыть его.`,
    giftMessageReceived: fmt`🎁 Подарок получен`,
    recentActions: 'Недавние действия',
    invoiceText: gift => `Приобретение подарка «${gift}»`,

    action_buy: 'Куплен',
    action_send: 'Отправлен',
    action_receive: 'Получен',

    profileEmpty: 'Вы можете купить подарок чтобы получить подарок в ответ.',
    storeTitle: 'Покупайте и отправляйте подарки',
    storeSubtitle: 'Уникальные подарки для всех от Crypto Pay.',
    giftsTitle: 'Отправляйте подарки в Telegram',
    giftsSubtitle: 'Отправляйте подарки, которые будут отображаться в профилях получателей в приложении.',
    giftsEmpty: 'Вы ещё не купили ни одного подарка.',
    actionsTitle: 'Недавние действия',
    actionsSubtitle: 'Вот список ваших последних действий.',
    actionsEmptyTitle: 'История пуста',
    actionsEmptySubtitle: 'Чтобы здесь что-то появилось, отправляйте и получайте подарки.',
    giftReceivedTitle: 'Получен подарок',
    giftReceivedSubtitle: gift => `Вы получили в подарок ${gift}.`,
    giftBoughtTitle: 'Вы купили подарок',
    giftBoughtSubtitle: 'Теперь отправьте его своему другу.',
    purchasedTitle: 'Подарок куплен',
    purchasedSubtitle: ({ gift, price, asset }) => `Вы купили «${gift}» за ${price} ${asset}.`,
  }
}

export const loc = function(locale, key) {
  return locales[locale][key];
};