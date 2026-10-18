import os
import sys
import paramiko

sys.stdout.reconfigure(encoding='utf-8')

HOST = '163.5.16.156'
PORT = 22
USER = 'root'
PASS = 'nsJhCdGSRgX8Y'
REMOTE_SERVER_DIR = '/var/www/app/server'

def sftp_upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except IOError:
        pass
    for item in os.listdir(local_dir):
        lpath = os.path.join(local_dir, item)
        rpath = f"{remote_dir}/{item}"
        if os.path.isdir(lpath):
            sftp_upload_dir(sftp, lpath, rpath)
        else:
            sftp.put(lpath, rpath)
            print(f"  [SFTP] Uploaded {item} -> {rpath}")

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    local_src = os.path.join(root_dir, 'apps', 'server', 'src')

    print("=== Step 1: Connecting to VPS via SSH ===")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
    sftp = ssh.open_sftp()
    print(f"[SSH] Connected to {USER}@{HOST}:{PORT}")

    print("\n=== Step 2: Updating .env file on VPS ===")
    env_path = f"{REMOTE_SERVER_DIR}/.env"
    try:
        with sftp.open(env_path, 'r') as f:
            current_env = f.read().decode('utf-8')
    except Exception:
        current_env = ""

    lines = current_env.splitlines()
    env_dict = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            k, v = line.split('=', 1)
            env_dict[k.strip()] = v.strip()

    # Set new AI provider config
    env_dict['AI_PROVIDER'] = 'anymodel'
    env_dict['ANYMODEL_API_KEY'] = 'sk-dc9d4b7df36ba555-q1c1pw-21b7fd37'
    env_dict['ANYMODEL_BASE_URL'] = 'https://anymodel.org/v1'
    env_dict['ANYMODEL_MODEL'] = 'gcli/grok-4.7'
    env_dict['ANYMODEL_TRANSLATE_MODEL'] = 'ag/gemini-3.7-flash-low'

    new_env_content = "\n".join([f"{k}={v}" for k, v in env_dict.items()]) + "\n"
    with sftp.open(env_path, 'w') as f:
        f.write(new_env_content.encode('utf-8'))
    print(f"[SFTP] Updated {env_path} with AnyModel settings")

    print("\n=== Step 3: Uploading updated server src/ files ===")
    sftp_upload_dir(sftp, local_src, f"{REMOTE_SERVER_DIR}/src")

    print("\n=== Step 4: Compiling server on VPS (npm run build) ===")
    build_cmd = f"cd {REMOTE_SERVER_DIR} && npm run build"
    stdin, stdout, stderr = ssh.exec_command(build_cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print(out)
    if err:
        print(f"[Build Info/Warning] {err}")

    print("\n=== Step 5: Restarting PM2 process notoc-server ===")
    restart_cmd = "pm2 restart notoc-server --update-env"
    stdin, stdout, stderr = ssh.exec_command(restart_cmd)
    print(stdout.read().decode('utf-8', errors='replace'))

    sftp.close()
    ssh.close()
    print("[SUCCESS] AnyModel provider deployment finished!")

if __name__ == '__main__':
    main()
