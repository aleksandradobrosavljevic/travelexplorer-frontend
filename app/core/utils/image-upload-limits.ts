export const MAX_IMAGE_FILE_SIZE_BYTES = 5_242_880;
export const MAX_IMAGE_FILE_SIZE_MB = 5;
export const IMAGE_UPLOAD_HINT = `JPG, PNG or WebP. Up to 15 images, max ${MAX_IMAGE_FILE_SIZE_MB} MB per image.`;

export function isImageFileTooLarge(file: File): boolean {
  return file.size > MAX_IMAGE_FILE_SIZE_BYTES;
}

export function oversizedImageMessage(files: File[]): string {
  const names = files.map(file => file.name).join(', ');
  return names
    ? `Image file exceeds the ${MAX_IMAGE_FILE_SIZE_MB} MB limit: ${names}.`
    : `Image file exceeds the ${MAX_IMAGE_FILE_SIZE_MB} MB limit.`;
}

export function splitImagesBySize(files: File[]): { accepted: File[]; rejected: File[] } {
  return files.reduce(
    (result, file) => {
      if (isImageFileTooLarge(file)) {
        result.rejected.push(file);
      } else {
        result.accepted.push(file);
      }

      return result;
    },
    { accepted: [] as File[], rejected: [] as File[] }
  );
}
