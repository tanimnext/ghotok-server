import * as userService from '../../services/user.service.js';
import { requestContext as ctx } from '../../utils/request.js';

export async function list(req, res) {
  res.json(await userService.listUsers(req.query, req.query));
}

export async function get(req, res) {
  res.json(await userService.getUserDetail(req.params.id));
}

export async function update(req, res) {
  res.json({ user: await userService.updateUser(req.params.id, req.body, ctx(req)) });
}

export async function create(req, res) {
  res.status(201).json({ user: await userService.createUser(req.body, ctx(req)) });
}

export async function resetPassword(req, res) {
  await userService.resetUserPassword(req.params.id, req.body.password, ctx(req));
  res.json({ ok: true });
}
