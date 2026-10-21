// Images attached to support messages and reports. The browser uploads them to
// ImgBB and sends the links; the validators only accept ImgBB URLs.

/** Stored shape of the attachment links of one message. */
export function toAttachments(urls = []) {
  return urls.length ? urls.map((url) => ({ url })) : undefined;
}
