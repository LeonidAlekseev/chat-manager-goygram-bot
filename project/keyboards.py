from typing import List 
from aiogram import types


def build_inline(buttons: List[list]) -> types.InlineKeyboardMarkup:
    keyboard = []
    for row in buttons:
        row_buttons = []
        for col in row:
            row_buttons.append(types.InlineKeyboardButton(**col))
        keyboard.append(row_buttons)

    return types.InlineKeyboardMarkup(
        inline_keyboard=keyboard,
        one_time_keyboard=True,
        resize_keyboard=True,
    )


def admin() -> types.InlineKeyboardMarkup:
    return build_inline(
        [
            [
                {
                    "text": "Добавить уведомление",
                    "callback_data": "cmd_add_notification",
                },
            ],
            [
                {
                    "text": "Редактировать уведомления",
                    "callback_data": "cmd_edit_notification",
                },
            ],
            [
                {
                    "text": "Отменить",
                    "callback_data": "cmd_cancel",
                },
            ],
        ]
    )


def superadmin() -> types.InlineKeyboardMarkup:
    return build_inline(
        [
            [
                {
                    "text": "Добавить админа",
                    "callback_data": "cmd_add_admin",
                },
            ],
            [
                {
                    "text": "Редактировать админов",
                    "callback_data": "cmd_edit_admin",
                },
            ],
            [
                {
                    "text": "Отменить",
                    "callback_data": "cmd_cancel",
                },
            ],
        ]
    )


def cancel() -> types.InlineKeyboardMarkup:
    return build_inline(
        [
            [
                {
                    "text": "Отменить",
                    "callback_data": "form_cancel",
                },
            ],
        ]
    )


def update() -> types.InlineKeyboardMarkup:
    return build_inline(
        [
            [
                {
                    "text": "Сохранить",
                    "callback_data": "form_save",
                },
                {
                    "text": "Отменить",
                    "callback_data": "form_cancel",
                },
            ],
        ]
    )


ADMIN = admin()
SUPERADMIN = superadmin()
CANCEL = cancel()
UPDATE = update()
