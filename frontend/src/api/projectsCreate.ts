import { createProjectWithOriginals } from "@/lib/rti-storage";

export async function handleProjectsCreate(
  request: Request,
): Promise<Response> {
  try {
    const formData = await request.formData();

    // Extract customerName
    let customerName = (formData.get("customerName") as string) || "";

    // Extract files (FormData might have multiple 'files' fields)
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if ((key === "files" || key === "files[]") && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No files uploaded." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate files
    const validFiles: File[] = [];
    for (const f of files) {
      if (
        f.name.toLowerCase().endsWith(".pdf") ||
        f.type === "application/pdf"
      ) {
        validFiles.push(f);
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unsupported file format: ${f.name}. Only PDFs are allowed.`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    if (!customerName.trim()) {
      customerName = validFiles[0].name.replace(/\.pdf$/i, "");
    }

    const project = await createProjectWithOriginals(customerName, validFiles);

    return new Response(JSON.stringify({ success: true, project }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("API /api/projects/create error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
