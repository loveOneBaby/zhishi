import { apiPostKey } from './client';
import { resolveAssetUrl } from './client';

// 上传图片(转 dataURL → /api/assets 落库去重),返回站内可用 url
export async function uploadAsset(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  const asset = await apiPostKey<{ url: string }>('/assets', { dataUrl, alt: file.name }, 'asset');
  return resolveAssetUrl(asset.url);
}
