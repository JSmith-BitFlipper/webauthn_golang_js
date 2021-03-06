import base64js from './base64';

// Add `.format()` function to the String type
// eslint-disable-next-line
String.prototype.format = function() {
    let a, k;
    a = this;
    for (k in arguments) {
        a = a.replace("{" + k + "}", arguments[k]);
    }
    return a;
}

function b64enc(buf) {
    return base64js.fromByteArray(buf)
                   .replace(/\+/g, "-")
                   .replace(/\//g, "_")
                   .replace(/=/g, "");
}

// https://stackoverflow.com/questions/10730362/get-cookie-by-name
function getCookie(name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    for(var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1,c.length);
        }
        if (c.indexOf(nameEQ) === 0) {
            return c.substring(nameEQ.length,c.length);
        }
    }
    return null;
}

async function fetch_json(url, options) {
    const response = await fetch(url, options);    
    const body = await response.json();
    if (body.fail)
        throw body.fail;
    return body;
}

/**
 * HELPER FUNCTIONS
 */

/**
 * Get the webauthn options for this user from the server
 * formData of the registration form
 * @param {FormData} formData 
 */
const getOptionsFromServer = async (formData, begin_url) => {
    return await fetch_json(
        begin_url,
        {
            method: "POST",
            body: formData
        }
    );
}

const retrieveWebauthnOptions_FormField = async (form_id, field_name) => {
    // Gather the data in the form
    const form = document.querySelector(form_id);
    const formData = new FormData(form);

    if (formData.get(field_name) === "") {
        return null;
    }

    const webauthn_options = JSON.parse(formData.get(field_name));
    return webauthn_options;
}

const retrieveWebauthnOptions_URL = async (form_id, src_url) => {
    // Gather the data in the form
    const form = document.querySelector(form_id);
    const formData = new FormData(form);

    // POST the form data to the server to retrieve the `webauthn_options`
    const webauthn_options = await getOptionsFromServer(formData, src_url);
    return webauthn_options;
}

const retrieveWebauthnOptions_Cookie = async (src_cookie) => {
    // TODO: Return `null` if cookie is not found
    const webauthn_options = JSON.parse(decodeURIComponent(getCookie(src_cookie)));
    return webauthn_options;
}

/**
 * REGISTRATION FUNCTIONS
 */

const getNewAssertionForServer = async (credentialCreateOptionsFromServer) => {
    if (!credentialCreateOptionsFromServer) {
        throw new Error("Webauthn registration requires creation options from server");
    }

    // Convert certain members of the PublicKeyCredentialCreateOptions into
    // byte arrays as expected by the spec.
    const publicKeyCredentialCreateOptions = 
          transformCredentialCreateOptions(credentialCreateOptionsFromServer);

    // Request the authenticator(s) to create a new credential keypair.
    const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreateOptions
    });

    // We now have a new credential! We now need to encode the byte arrays
    // in the credential into strings, for posting to our server.
    const newAssertionForServer = transformNewAssertionForServer(credential);

    return newAssertionForServer
}

const registrationFinish_URL = async (credentialCreateOptionsFromServer, finish_url, form_id) => {
    let formData;
    if (form_id !== null) {
        // Gather the data in the form
        const form = document.querySelector(form_id);
        formData = new FormData(form);
    } else {
        formData = new FormData();
    }

    // Get the new assertion data for the server
    const newAssertionForServer = await getNewAssertionForServer(credentialCreateOptionsFromServer);

    // POST the transformed credential data to the server for validation
    // and storing the public key
    const response = await postNewAssertionToServer(formData, newAssertionForServer, finish_url);

    // Go to the url in the `response`
    if (response && response.redirectTo) {
        window.location.assign(response.redirectTo);
    }
}

const registrationFinish_PostFn = async (credentialCreateOptionsFromServer, post_fn) => {
    // Get the new assertion data for the server
    const newAssertionForServer = await getNewAssertionForServer(credentialCreateOptionsFromServer);

    // Use the `post_fn` to send over the `newAssertionForServer`
    const response = await post_fn(JSON.stringify(newAssertionForServer));

    // Go to the url in the `response`
    if (response && response.redirectTo) {
        window.location.assign(response.redirectTo);
    }
}

const transformCredentialRequestOptions = (credentialRequestOptionsFromServer) => {
    let {challenge, allowCredentials} = credentialRequestOptionsFromServer;

    // eslint-disable-next-line
    challenge = Uint8Array.from(atob(challenge.replace(/\_/g, "/").replace(/\-/g, "+")), c => c.charCodeAt(0));

    allowCredentials = allowCredentials.map(credentialDescriptor => {
        let {id} = credentialDescriptor;
        // eslint-disable-next-line
        id = id.replace(/\_/g, "/").replace(/\-/g, "+");
        id = Uint8Array.from(atob(id), c => c.charCodeAt(0));
        return Object.assign({}, credentialDescriptor, {id});
    });

    const transformedCredentialRequestOptions = Object.assign(
        {},
        credentialRequestOptionsFromServer,
        {challenge, allowCredentials});

    return transformedCredentialRequestOptions;
};


/**
 * Transforms items in the credentialCreateOptions generated on the server
 * into byte arrays expected by the navigator.credentials.create() call
 * @param {Object} credentialCreateOptionsFromServer 
 */
const transformCredentialCreateOptions = (credentialCreateOptionsFromServer) => {
    let {challenge, user} = credentialCreateOptionsFromServer;
    user.id = Uint8Array.from(
        atob(credentialCreateOptionsFromServer.user.id
             // eslint-disable-next-line
            .replace(/\_/g, "/").replace(/\-/g, "+")
            ), 
        c => c.charCodeAt(0));

    challenge = Uint8Array.from(
        atob(credentialCreateOptionsFromServer.challenge
             // eslint-disable-next-line
            .replace(/\_/g, "/").replace(/\-/g, "+")
            ),
        c => c.charCodeAt(0));
    
    const transformedCredentialCreateOptions = Object.assign(
            {}, credentialCreateOptionsFromServer,
            {challenge, user});

    return transformedCredentialCreateOptions;
}

/**
 * AUTHENTICATION FUNCTIONS
 */

const getTransformedAssertionForServer = async (credentialRequestOptionsFromServer) => {
    let transformedAssertionForServer;

    // Webauthn is enabled
    if (credentialRequestOptionsFromServer) {
        // Convert certain members of the PublicKeyCredentialRequestOptions into
        // byte arrays as expected by the spec.    
        const transformedCredentialRequestOptions = transformCredentialRequestOptions(
            credentialRequestOptionsFromServer);

        // Request the authenticator to create an assertion signature using the
        // credential private key
        const assertion = await navigator.credentials.get({
            publicKey: transformedCredentialRequestOptions,
        });

        // We now have an authentication assertion! encode the byte arrays contained
        // in the assertion data as strings for posting to the server
        transformedAssertionForServer = transformAssertionForServer(assertion);
    } else {
        //Webauthn is not enabled, so return an empty assertion
        transformedAssertionForServer = "";
    }

    return transformedAssertionForServer;
}

const attestationFinish_URL = async (credentialRequestOptionsFromServer, finish_url, form_id) => {
    let formData;
    if (form_id !== null) {
        // Gather the data in the form
        const form = document.querySelector(form_id);
        formData = new FormData(form);
    } else {
        formData = new FormData();
    }

    const transformedAssertionForServer = await getTransformedAssertionForServer(credentialRequestOptionsFromServer);
    const response = await postAssertionToServer(transformedAssertionForServer, finish_url, formData);

    // Go to the url in the `response`
    window.location.assign(response.redirectTo);
}

const attestationFinish_PostFn = async (credentialRequestOptionsFromServer, post_fn) => {
    // Get the transformed assertion data for the server
    const transformedAssertionForServer = await getTransformedAssertionForServer(credentialRequestOptionsFromServer);

    // Use the `post_fn` to send over the `transformedAssertionForServer`
    const response = await post_fn(JSON.stringify(transformedAssertionForServer));

    return response;
}

/**
 * Transforms the binary data in the credential into base64 strings
 * for posting to the server.
 * @param {PublicKeyCredential} newAssertion 
 */
const transformNewAssertionForServer = (newAssertion) => {
    const attObj = new Uint8Array(
        newAssertion.response.attestationObject);
    const clientDataJSON = new Uint8Array(
        newAssertion.response.clientDataJSON);
    const rawId = new Uint8Array(
        newAssertion.rawId);

    return {
        id: newAssertion.id,
        rawId: b64enc(rawId),
        type: newAssertion.type,
        response: {
            attestationObject: b64enc(attObj),
            clientDataJSON: b64enc(clientDataJSON),
        },
    };
}

/**
 * Posts the new credential data to the server for validation and storage.
 * @param {Object} credentialDataForServer 
 */
const postNewAssertionToServer = async (formData, credentialDataForServer, finish_url) => {
    return await fetch_json(
        finish_url, 
        {
            method: "POST",
            headers: 
            {
                'X-CSRF-TOKEN': formData.get('_csrf')
            },
            body: JSON.stringify(credentialDataForServer)
        });
}

/**
 * Encodes the binary data in the assertion into strings for posting to the server.
 * @param {PublicKeyCredential} newAssertion 
 */
const transformAssertionForServer = (newAssertion) => {
    const authData = new Uint8Array(newAssertion.response.authenticatorData);
    const clientDataJSON = new Uint8Array(newAssertion.response.clientDataJSON);
    const rawId = new Uint8Array(newAssertion.rawId);
    const sig = new Uint8Array(newAssertion.response.signature);

    return {
        id: newAssertion.id,
        rawId: b64enc(rawId),
        type: newAssertion.type,
        response: {
            authenticatorData: b64enc(authData),
            clientDataJSON: b64enc(clientDataJSON),
            signature: b64enc(sig),
        }
    };
};

/**
 * Post the assertion to the server for validation and logging the user in. 
 * @param {Object} assertionDataForServer 
 */
const postAssertionToServer = async (assertionDataForServer, finish_url, formData) => {
    // Pass over the webauthn assertion in JSON format
    formData.set('webauthn_data', JSON.stringify(assertionDataForServer));

    return await fetch(
        finish_url,
        {
            method: "POST",
            body: formData
        }
    );
}

// Export the various functions of this module
export { 
    // Helper functions
    retrieveWebauthnOptions_FormField,
    retrieveWebauthnOptions_URL,
    retrieveWebauthnOptions_Cookie,

    // Registration functions
    registrationFinish_URL, 
    registrationFinish_PostFn,

    // Attestation functions
    attestationFinish_URL ,
    attestationFinish_PostFn,
};
