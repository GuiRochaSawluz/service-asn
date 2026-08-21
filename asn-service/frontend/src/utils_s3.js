/**
 * utils_s3.js
 * Utility helper to sanitize user-facing labels and error messages
 * referencing S3 or raw cloud storage when the user is not a master user.
 */

export function sanitizeS3Text(text, isMasterUser) {
  if (isMasterUser) return text;
  if (!text) return text;

  // Replace case-insensitive standalone S3 mentions with "documento"
  let clean = text.replace(/\bS3\b/gi, 'documento');
  
  // Replace s3-download with download in case API endpoint names show up in raw errors
  clean = clean.replace(/s3-download/gi, 'download');
  
  return clean;
}
