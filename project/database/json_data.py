import os
import json
from aiogram import types


DATA_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'data')
UDATA_PATH = os.path.join(DATA_DIR, 'users.json')
MDATA_PATH = os.path.join(DATA_DIR, 'messages.json')


if not os.path.exists(UDATA_PATH):
    with open(UDATA_PATH, 'w') as f:
        json.dump({"users": {"superadmin": [
            {
                'uid': 676318616,
                'name': 'Леонид',
            },
        ], "admin": [
            {
                'uid': 676318616,
                'name': 'Леонид',
            },
        ]}}, f)
if not os.path.exists(MDATA_PATH):
    with open(MDATA_PATH, 'w') as f:
        json.dump({"messages": {}}, f)


def read_data(path):
    with open(path, 'r') as f:
        data = json.loads(f.read())
    return data

def write_data(path, data):
    with open(path, 'w') as f:
        json.dump(data, f)


def get_admin(_type="admin", path=UDATA_PATH):
    data = read_data(path)
    utype = data["users"].get(_type, [])
    return utype

def add_admin(uid, name, _type="admin", path=UDATA_PATH):
    data = read_data(path)
    uid = int(uid)
    utype = data["users"].setdefault(_type, [])
    utype.append({
        "uid": uid,
        "name": name,
    })
    write_data(path, data)

def del_admin(uid, _type="admin", path=UDATA_PATH):
    data = read_data(path)
    uid = int(uid)
    data["users"][_type] = list(filter(
        lambda usr: usr['uid'] != uid,
        data["users"][_type]
    ))
    write_data(path, data)


def get_notification(uid=None, path=MDATA_PATH):
    data = read_data(path)
    if uid is None:
        msg = data["messages"]
        return msg
    uid = str(uid)
    umsg = data["messages"].get(uid, {})
    return umsg

def add_notification(uid, cid, mid, name, datetime, period, path=MDATA_PATH):
    data = read_data(path)
    uid = str(uid)
    _cid = list(cid)
    mid = str(mid)
    umsg = data["messages"].setdefault(uid, {})
    for cid in _cid:
        ucmsg = umsg.setdefault(cid, [])
        ucmsg.append({
            "mid": mid,
            "name": name,
            "datetime": datetime,
            "period": period,
        })
    write_data(path, data)

def del_notification(uid, cid, mid, path=MDATA_PATH):
    data = read_data(path)
    uid = str(uid)
    cid = str(cid)
    data["messages"][uid][cid] = list(filter(
        lambda msg: msg['mid'] != mid,
        data["messages"][uid][cid]
    ))
    write_data(path, data)

def upd_notification(uid, cid, mid, datetime, path=MDATA_PATH):
    data = read_data(path)
    uid = str(uid)
    cid = str(cid)
    ucmsg = data["messages"][uid][cid]
    for msg in ucmsg:
        if msg["mid"] == mid:
            msg["datetime"] = datetime
            break
    write_data(path, data)
