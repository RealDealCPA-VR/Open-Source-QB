/**
 * GET  /api/recurring        — list recurring templates for this company
 * POST /api/recurring        — create a new recurring template
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listTemplates, createTemplate } from '@/lib/services/recurring';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'CONFLICT'
            ? 409
            : err.code === 'FORBIDDEN'
              ? 403
              : err.code === 'PERIOD_CLOSED'
                ? 400
                : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[recurring/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const templates = await listTemplates(ctx);
    return NextResponse.json(templates);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    if (!body.name) {
      return NextResponse.json({ error: 'name is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.docType) {
      return NextResponse.json({ error: 'docType is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.frequency) {
      return NextResponse.json({ error: 'frequency is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.template || typeof body.template !== 'object') {
      return NextResponse.json({ error: 'template payload is required', code: 'VALIDATION' }, { status: 400 });
    }

    const tpl = await createTemplate(ctx, {
      name: body.name,
      docType: body.docType,
      frequency: body.frequency,
      nextRunDate: body.nextRunDate ? new Date(body.nextRunDate) : new Date(),
      template: body.template,
    });

    return NextResponse.json(tpl, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
