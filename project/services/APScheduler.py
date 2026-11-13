import pytz
import datetime as dt
from dateutil.relativedelta import relativedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import cfg_tz, bot
from utils import functions
from database.json_data import get_notification, del_notification, upd_notification


DATETIME_FORMAT = '%d.%m.%Y %H:%M'
PERIODS_FORMAT = {
    'minute': relativedelta(minutes=1),
    'day': relativedelta(days=1),
    'week': relativedelta(weeks=1),
    'twoweek': relativedelta(weeks=2),
    'month': relativedelta(month=1),
}


scheduler = AsyncIOScheduler(timezone=cfg_tz.name)
timezone = pytz.timezone(zone=cfg_tz.name)
utcoffset = timezone.utcoffset(dt.datetime.utcnow())


async def ucmsg_process(uid, cid, mid, name, datetime, period):
    try:
        now_datetime = dt.datetime.utcnow().replace(second=0, microsecond=0) + utcoffset
        datetime = dt.datetime.strptime(datetime, DATETIME_FORMAT)
        if period != 'none':
            while datetime < now_datetime:
                datetime += PERIODS_FORMAT[period]
            if now_datetime == datetime:
                await bot.copy_message(from_chat_id=uid, chat_id=cid, message_id=mid)
                datetime += PERIODS_FORMAT[period]
            datetime = datetime.strftime(DATETIME_FORMAT)
            upd_notification(uid, cid, mid, datetime)
    except BaseException as e:
        # del_notification(uid, cid, mid)
        submsgs = [
            f'User ID: {uid}\nChat ID: {cid}\nMessage ID: {mid}\nName: {name}\nDatetime: {datetime}\nPeriod: {period}',
            # f'<b>Удалено системой</b>',
            f'<b>Ошибка системы</b>',
        ]
        await functions.logging_exeption(uid, e, submsgs=submsgs)


async def notify():
    msg = get_notification()
    for uid in msg.keys():
        umsg = msg[uid]
        for cid in umsg.keys():
            for ucmsg in umsg[cid]:
                await ucmsg_process(uid, cid, **ucmsg)


def setup():
    scheduler.add_job(notify, trigger='cron', minute='*')
    scheduler.start()
