export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code = "INTERNAL_ERROR",
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      {
        code: error.code,
        message: error.message,
      },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";

  return Response.json(
    {
      code: "INTERNAL_ERROR",
      message,
    },
    { status: 500 },
  );
}
