import { getConfig } from '../config.js';
import { HttpError } from '../errors.js';

function keygenBaseUrl() {
  return `https://api.keygen.sh/v1/accounts/${encodeURIComponent(
    getConfig().keygenAccountId
  )}`;
}

function authHeaders(authHeader = `Bearer ${getConfig().keygenApiToken}`) {
  const headers = {
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json'
  };
  if (authHeader) {
    headers.Authorization = authHeader;
  }
  return headers;
}

async function keygenRequest(path, options = {}) {
  const response = await fetch(`${keygenBaseUrl()}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.authHeader),
      ...(options.headers || {})
    }
  });

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new HttpError(
      response.status,
      body?.errors?.[0]?.detail || body?.errors?.[0]?.title || 'Keygen request failed.',
      body
    );
  }

  return body;
}

export async function createLicense({ email, metadata }) {
  return keygenRequest('/licenses', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'licenses',
        attributes: {
          name: email,
          metadata
        },
        relationships: {
          policy: {
            data: {
              type: 'policies',
              id: getConfig().keygenPolicyId
            }
          }
        }
      }
    })
  });
}

export async function retrieveLicense(licenseId) {
  return keygenRequest(`/licenses/${encodeURIComponent(licenseId)}`, {
    method: 'GET'
  });
}

export async function listLicensesByMetadata(key, value) {
  const params = new URLSearchParams();
  params.set(`metadata[${key}]`, String(value));
  params.set('limit', '100');
  return keygenRequest(`/licenses?${params.toString()}`, {
    method: 'GET'
  });
}

export async function findLicenseByMetadata(key, value) {
  const licenses = await listLicensesByMetadata(key, value);
  return licenses.data?.[0] || null;
}

export async function findLicenseByAnyIdentifier({ licenseId, subscriptionId, email }) {
  if (licenseId) {
    return (await retrieveLicense(licenseId)).data;
  }
  if (subscriptionId) {
    return findLicenseByMetadata('stripeSubscriptionId', subscriptionId);
  }
  if (email) {
    return findLicenseByMetadata('customerEmail', email.toLowerCase());
  }
  throw new HttpError(400, 'Provide licenseId, subscriptionId, or email.');
}

export async function updateLicenseMetadata(license, metadataPatch) {
  const id = license.id;
  const existingMetadata = license.attributes?.metadata || {};
  return keygenRequest(`/licenses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'licenses',
        id,
        attributes: {
          metadata: {
            ...existingMetadata,
            ...metadataPatch,
            updatedAt: new Date().toISOString()
          }
        }
      }
    })
  });
}

export async function suspendLicense(licenseId) {
  return keygenRequest(`/licenses/${encodeURIComponent(licenseId)}/actions/suspend`, {
    method: 'POST'
  });
}

export async function reinstateLicense(licenseId) {
  return keygenRequest(`/licenses/${encodeURIComponent(licenseId)}/actions/reinstate`, {
    method: 'POST'
  });
}

export async function validateLicenseKey({ licenseKey, fingerprint }) {
  const meta = {
    key: licenseKey,
    scope: {
      product: getConfig().keygenProductId
    }
  };
  if (fingerprint) {
    meta.scope.fingerprint = fingerprint;
  }

  return keygenRequest('/licenses/actions/validate-key', {
    method: 'POST',
    authHeader: null,
    body: JSON.stringify({ meta })
  });
}

export async function activateMachine({ licenseId, licenseKey, fingerprint, name, platform }) {
  return keygenRequest('/machines', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'machines',
        attributes: {
          fingerprint,
          name,
          platform
        },
        relationships: {
          license: {
            data: {
              type: 'licenses',
              id: licenseId
            }
          }
        }
      }
    })
  });
}

export async function listMachines() {
  return keygenRequest('/machines?limit=100', {
    method: 'GET'
  });
}

export async function listMachinesForLicense(licenseId) {
  const machines = await keygenRequest('/machines?limit=100', {
    method: 'GET'
  });
  const data = machines.data || [];
  return data.filter(
    (machine) => machine.relationships?.license?.data?.id === licenseId
  );
}

export async function deleteMachine(machineId) {
  return keygenRequest(`/machines/${encodeURIComponent(machineId)}`, {
    method: 'DELETE'
  });
}

export async function resetMachinesForLicense(licenseId) {
  const machines = await listMachines();
  const matching = (machines.data || []).filter(
    (machine) => machine.relationships?.license?.data?.id === licenseId
  );

  await Promise.all(matching.map((machine) => deleteMachine(machine.id)));
  return { removed: matching.length };
}
