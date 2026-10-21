import * as bannerService from '../../services/banner.service.js';
import * as contentService from '../../services/content.service.js';
import * as storyService from '../../services/story.service.js';
import { requestContext as ctx } from '../../utils/request.js';

export async function settings(_req, res) {
  res.json({ settings: await contentService.allSettings() });
}

export async function updateSettings(req, res) {
  const { key } = req.params;
  res.json({ key, value: await contentService.updateSettings(key, req.body.value, ctx(req)) });
}

export async function pages(_req, res) {
  res.json({ items: await contentService.listPages() });
}

export async function page(req, res) {
  res.json({ page: await contentService.getPage(req.params.slug) });
}

export async function upsertPage(req, res) {
  res.json({ page: await contentService.upsertPage(req.params.slug, req.body, ctx(req)) });
}

export async function deletePage(req, res) {
  await contentService.deletePage(req.params.slug, ctx(req));
  res.json({ ok: true });
}

export async function faqs(_req, res) {
  res.json({ items: await contentService.listFaqs() });
}

export async function createFaq(req, res) {
  res.status(201).json({ faq: await contentService.createFaq(req.body, ctx(req)) });
}

export async function updateFaq(req, res) {
  res.json({ faq: await contentService.updateFaq(req.params.id, req.body) });
}

export async function deleteFaq(req, res) {
  await contentService.deleteFaq(req.params.id, ctx(req));
  res.json({ ok: true });
}

export async function marriageReports(req, res) {
  res.json(await storyService.listMarriageReports(req.query, req.query));
}

export async function updateStory(req, res) {
  res.json({ story: await storyService.updateStory(req.params.id, req.body, ctx(req)) });
}

export async function banners(_req, res) {
  res.json({ items: await bannerService.listBanners() });
}

export async function bannerUploadUrl(req, res) {
  res.json(await bannerService.createBannerUpload(req.user._id, req.body));
}

export async function createBanner(req, res) {
  res.status(201).json({ banner: await bannerService.createBanner(req.body, ctx(req)) });
}

export async function updateBanner(req, res) {
  res.json({ banner: await bannerService.updateBanner(req.params.id, req.body, ctx(req)) });
}

export async function deleteBanner(req, res) {
  await bannerService.deleteBanner(req.params.id, ctx(req));
  res.json({ ok: true });
}
