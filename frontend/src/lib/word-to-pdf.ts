export async function convertWordToPdfBlob(_file: File): Promise<Blob> {
  throw new Error(
    "DOC/DOCX files are not supported. Only PDF, JPG, PNG, WEBP files are allowed.",
  );
}
