import * as bannerService from '../services/banner.service.js';
import * as contentService from '../services/content.service.js';
import * as storyService from '../services/story.service.js';

export async function stats(_req, res) {
  res.json(await contentService.publicStats());
}

export async function settings(_req, res) {
  res.json(await contentService.publicSettings());
}

export async function page(req, res) {
  res.json({ page: await contentService.publishedPage(req.params.slug) });
}

export async function faqs(_req, res) {
  res.json({ items: await contentService.activeFaqs() });
}

export async function successStories(_req, res) {
  res.json({ items: await storyService.publishedStories() });
}

export async function banners(_req, res) {
  res.json({ items: await bannerService.activeBanners() });
}

export async function downloadBanner(req, res) {
  res.json(await bannerService.downloadBanner(req.params.id));
}
