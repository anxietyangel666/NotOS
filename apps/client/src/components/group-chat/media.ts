// Message media/mention helpers for the group chat view (extracted from
// GroupChatView.tsx).
import type { ChatMediaItem, GroupMessage } from '../../api/types';
import { parseForward } from '../../utils/forward';
import { shouldShowDateDivider } from '../../utils/message-date';
import { isVideoCircleAttachment, isVoiceAttachment } from '../VoiceMessage';
import { MAX_CHAT_MEDIA_BATCH } from './constants';

export function mentionToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

export function messageMentionTokens(body: string) {
  return new Set(Array.from(body.matchAll(/(?:^|[\s([{<])@([\p{L}\p{N}_.-]{1,50})/gu), (match) => mentionToken(match[1])));
}

export function isGifSource(src: string) {
  if (src.startsWith('data:image/gif')) return true;
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const parsed = new URL(src);
    const host = parsed.hostname.replace(/^www\./, '');
    if (parsed.pathname.startsWith('/uploads/chat/')) return /\.gif(?:[?#]|$)/i.test(parsed.pathname);
    return /\.gif(?:[?#]|$)/i.test(parsed.pathname)
      || host === 'media.tenor.com'
      || host.endsWith('.tenor.com')
      || host === 'media.giphy.com'
      || host.endsWith('.giphy.com');
  } catch {
    return /\.gif(?:[?#]|$)/i.test(src);
  }
}

export function isImageSource(src: string) {
  if (src.startsWith('data:image/')) return !isGifSource(src);
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const parsed = new URL(src);
    if (parsed.pathname.startsWith('/uploads/chat/')) return /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(parsed.pathname) && !isGifSource(src);
    return /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isGifAttachment(message: GroupMessage) {
  return isGifSource(message.imageData ?? '');
}

export function isImageAttachment(message: GroupMessage) {
  return isImageSource(message.imageData ?? '');
}

export function getMessageMediaItems(message: Pick<GroupMessage, 'mediaItems' | 'imageData' | 'imageName' | 'imageSpoiler'>): ChatMediaItem[] {
  if (Array.isArray(message.mediaItems) && message.mediaItems.length > 0) return message.mediaItems;
  return message.imageData ? [{ dataUrl: message.imageData, name: message.imageName, spoiler: message.imageSpoiler }] : [];
}

export function groupMessageRunIdentity(message: GroupMessage) {
  return message.senderGroup ? `group:${message.senderGroup.id}:user:${message.senderId}` : `user:${message.senderId}`;
}

export function isAlbumImageMessage(message: GroupMessage) {
  return !message.deletedAt
    && Boolean(message.imageData)
    && isImageAttachment(message)
    && !isVoiceAttachment(message.imageData, message.imageName)
    && !isVideoCircleAttachment(message.imageData, message.imageName)
    && !parseForward(message.body);
}

export function canAppendToImageAlbum(previous: GroupMessage, message: GroupMessage) {
  return isAlbumImageMessage(previous)
    && isAlbumImageMessage(message)
    && !message.body
    && !message.replyTo
    && !shouldShowDateDivider(message.createdAt, previous.createdAt)
    && groupMessageRunIdentity(previous) === groupMessageRunIdentity(message)
    && Math.abs(new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) <= 120000;
}

export function clipboardImageFiles(data: DataTransfer) {
  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

export async function readClipboardImageFiles(limit = MAX_CHAT_MEDIA_BATCH) {
  if (limit <= 0) return [];
  if (!navigator.clipboard?.read) return [];
  const files: File[] = [];
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const extension = imageType.split('/')[1]?.split('+')[0] || 'png';
      files.push(new File([blob], `clipboard-image-${files.length + 1}.${extension}`, { type: imageType }));
      if (files.length >= limit) break;
    }
  } catch {
    return [];
  }
  return files;
}
