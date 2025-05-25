exports.handler = async (event) => {
  try {
    // Handle the download request here
    const { result, image } = JSON.parse(event.body);
    // Generate the PDF file
    // ...
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=plant_analysis_report_${Date.now()}.pdf`,
      },
      body: pdfBuffer,
    };
  } catch (error) {
    console.error("Error during download:", error);
    return {
      statusCode: 500,
      body: "Error during download",
    };
  }
};