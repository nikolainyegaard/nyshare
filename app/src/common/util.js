export function humanFileSize(fileSizeInBytes) {
  let i = -1;
  const byteUnits = [' kB', ' MB', ' GB', ' TB', 'PB', 'EB', 'ZB', 'YB'];
  do {
    fileSizeInBytes = fileSizeInBytes / 1024;
    i++;
  }
  while (fileSizeInBytes > 1024);
  return Math.max(fileSizeInBytes, 0.01).toFixed(2) + byteUnits[i];
}

export async function httpGet(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          resolve(JSON.parse(xhr.responseText))
        }
        catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`HTTP-GET error: ${ xhr.status } ${ xhr.statusText }`))
      }
    };
    xhr.send();
  });
}

export async function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          resolve(JSON.parse(xhr.responseText))
        }
        catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`HTTP-POST error: ${ xhr.status } ${ xhr.statusText }`))
      }
    };
    xhr.send(JSON.stringify(data));
  });
}
