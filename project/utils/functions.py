import logging
import asyncio
from aiogram import types

from config import cfg, bot


async def logging_exeption(uid=None, e='Error', submsgs=None):
	logging.exception(str(e))
	if uid is not None:
		await bot.send_message(uid, '<b>Ошибка:</b>')
		await bot.send_message(uid, str(e))
		if submsgs is not None:
			for submsg in submsgs:
				await bot.send_message(uid, submsg)


async def get_chat_members(chat_id, is_admin=False):
	import pyrogram
	members = []
	if cfg.session_string is None:
		client = pyrogram.Client(
			"pyrogram",
			api_id=cfg.api_id,
			api_hash=cfg.api_hash,
			phone_number=cfg.phone_number,
			no_updates=True,
		)
	else:
		client = pyrogram.Client(
			"pyrogram",
			session_string=cfg.session_string,
			no_updates=True,
		)
	async with client as app:
		chat_id = int(chat_id)
		if is_admin:
			members_loop = app.get_chat_members(chat_id, limit=0, filter=pyrogram.enums.ChatMembersFilter.ADMINISTRATORS)
		else: 
			members_loop = app.get_chat_members(chat_id, limit=0)
		async for m in members_loop:
			members.append(m)
		cfg.session_string = await app.export_session_string()
	return members


def delete_message(message, sleep_time=0):
	async def task(message, sleep_time=0):
		await asyncio.sleep(sleep_time)
		try:
			if isinstance(message, dict):
				await bot.delete_message(
					chat_id=int(message['chat_id']),
					message_id=int(message['message_id']),
				)
			else:
				await message.delete()
		except BaseException as e:
			await logging_exeption(e=e)

	
	if isinstance(message, list):
		for msg in message:
			delete_message(msg)
	else:
		asyncio.create_task(task(message, sleep_time))


def check_start_command(text):
	result = {
		'exist': False,
		'data': {
			'command': '',
			'data': ''
		}
	}

	try: text = text.split()[1].split('-')
	except: return result

	try:
		command = text[0]
		data = text[1]
	except: return result

	result['exist'] = True
	result['data']['command'] = command
	result['data']['data'] = data
	
	return result


async def handler_start_command(message: types.Message, command: str, data: str, payload: dict=None) -> None:
	if command == 'ref':
		if payload['is_new']:
			pass